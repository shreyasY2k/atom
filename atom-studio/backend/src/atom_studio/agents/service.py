import base64
import hashlib
import secrets
from datetime import datetime, timezone

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import jwt as jose_jwt
from pydantic import BaseModel

from ..config import get_settings
from ..database import get_conn
from ..redis_client import get_redis


# ── Crypto helpers ─────────────────────────────────────────────────────────────


def encrypt_virtual_key(virtual_key: str) -> str:
    settings = get_settings()
    key = bytes.fromhex(settings.atom_encryption_key)
    nonce = secrets.token_bytes(12)
    ct = AESGCM(key).encrypt(nonce, virtual_key.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_virtual_key(encrypted: str) -> str:
    settings = get_settings()
    key = bytes.fromhex(settings.atom_encryption_key)
    data = base64.b64decode(encrypted)
    return AESGCM(key).decrypt(data[:12], data[12:], None).decode()


def issue_agent_jwt(agent_id: str, domain_id: str) -> str:
    """
    RS256 JWT for the agent — same key pair GATE validates.
    No expiry: tokens are revoked explicitly via agent_tokens.revoked_at.
    """
    settings = get_settings()
    payload = {
        "sub": f"agent-{agent_id}",
        "type": "agent",
        "agent_id": agent_id,
        "domain_id": domain_id,
        "iss": "atom-studio",
        "iat": int(datetime.now(timezone.utc).timestamp()),
    }
    return jose_jwt.encode(payload, settings.jwt_private_key, algorithm="RS256")


# ── Pydantic payload models ────────────────────────────────────────────────────


class MemoryConfigPayload(BaseModel):
    short_term_ttl_s: int = 3600
    max_vectors: int = 100_000
    embedding_model: str = "text-embedding-3-small"


class AgentCreatePayload(BaseModel):
    name: str
    description: str | None = None
    allowed_models: list[str] = ["gemini-2.5-flash"]
    rpm_limit: int = 60
    tpm_limit: int = 100_000
    hitl_timeout_seconds: int = 300
    hitl_fallback: str = "ABORT"
    tool_ids: list[str] = []
    skill_ids: list[str] = []
    memory_config: MemoryConfigPayload | None = None


# ── Service functions ──────────────────────────────────────────────────────────


async def create_agent(
    domain_id: str, payload: AgentCreatePayload, owner_id: str
) -> tuple[dict, str]:
    """
    Full provisioning chain: INSERT agent → LiteLLM provision → encrypt key
    → issue JWT → store token hash.
    Returns (agent_dict, raw_jwt). raw_jwt must be shown to the user immediately
    — it is never stored and cannot be recovered.
    """
    settings = get_settings()

    async with get_conn() as conn:
        async with conn.transaction():
            domain = await conn.fetchrow(
                "SELECT id, litellm_team_id FROM domains WHERE id=$1 AND is_active=true",
                domain_id,
            )
            if not domain:
                raise ValueError("Domain not found")
            if not domain["litellm_team_id"]:
                raise ValueError("Domain has no LiteLLM team — provision the domain first")

            agent = await conn.fetchrow(
                """
                INSERT INTO agents (
                    domain_id, name, description, status, owner_id,
                    allowed_models, rpm_limit, tpm_limit,
                    hitl_timeout_seconds, hitl_fallback
                ) VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9)
                RETURNING *
                """,
                domain_id,
                payload.name,
                payload.description,
                owner_id,
                payload.allowed_models,
                payload.rpm_limit,
                payload.tpm_limit,
                payload.hitl_timeout_seconds,
                payload.hitl_fallback,
            )

            try:
                async with httpx.AsyncClient(timeout=15) as client:
                    resp = await client.post(
                        f"{settings.atom_llm_url}/atom/provision_agent",
                        json={
                            "agent_id": str(agent["id"]),
                            "agent_name": payload.name,
                            "team_id": str(domain["litellm_team_id"]),
                            "allowed_models": payload.allowed_models,
                            "rpm_limit": payload.rpm_limit,
                            "tpm_limit": payload.tpm_limit,
                        },
                    )
                    resp.raise_for_status()
                    litellm_data = resp.json()
            except Exception as e:
                raise RuntimeError(f"LiteLLM agent provisioning failed: {e}")

            encrypted_key = encrypt_virtual_key(litellm_data["virtual_key"])
            await conn.execute(
                """
                UPDATE agents
                SET litellm_agent_id=$1, litellm_virtual_key=$2
                WHERE id=$3
                """,
                litellm_data["litellm_agent_id"],
                encrypted_key,
                agent["id"],
            )

            raw_jwt = issue_agent_jwt(str(agent["id"]), domain_id)
            token_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()
            await conn.execute(
                "INSERT INTO agent_tokens (agent_id, token_hash) VALUES ($1,$2)",
                agent["id"],
                token_hash,
            )

            for tool_id in payload.tool_ids:
                await conn.execute(
                    "INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1,$2)",
                    agent["id"],
                    tool_id,
                )
            for skill_id in payload.skill_ids:
                await conn.execute(
                    "INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1,$2)",
                    agent["id"],
                    skill_id,
                )

            if payload.memory_config:
                mem = await conn.fetchrow(
                    """
                    INSERT INTO memory_configs (short_term_ttl_s, max_vectors, embedding_model)
                    VALUES ($1,$2,$3)
                    RETURNING id
                    """,
                    payload.memory_config.short_term_ttl_s,
                    payload.memory_config.max_vectors,
                    payload.memory_config.embedding_model,
                )
                await conn.execute(
                    "UPDATE agents SET memory_config_id=$1 WHERE id=$2",
                    mem["id"],
                    agent["id"],
                )

        # Build final dict with LiteLLM IDs set (don't expose encrypted key)
        result = dict(agent)
        result["litellm_agent_id"] = litellm_data["litellm_agent_id"]
        result.pop("litellm_virtual_key", None)

    return result, raw_jwt


async def regenerate_token(agent_id: str) -> str:
    """
    Revoke active token, blacklist its hash in Redis for 24h,
    issue and persist a new token.
    """
    redis = await get_redis()

    async with get_conn() as conn:
        # Only revoke client tokens — pod tokens must remain valid for the running container.
        old_clients = await conn.fetch(
            "SELECT token_hash FROM agent_tokens WHERE agent_id=$1 AND revoked_at IS NULL AND token_type='client'",
            agent_id,
        )
        if old_clients:
            await conn.execute(
                "UPDATE agent_tokens SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL AND token_type='client'",
                agent_id,
            )
            for row in old_clients:
                await redis.set(f"token_revoked:{row['token_hash']}", "1", ex=86400)

        agent = await conn.fetchrow("SELECT domain_id FROM agents WHERE id=$1", agent_id)
        raw_jwt = issue_agent_jwt(agent_id, str(agent["domain_id"]))
        token_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()
        await conn.execute(
            "INSERT INTO agent_tokens (agent_id, token_hash, token_type) VALUES ($1,$2,'client')",
            agent_id,
            token_hash,
        )

    return raw_jwt


async def list_agents(domain_id: str) -> list[dict]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT a.*,
                   count(DISTINCT ato.tool_id)  AS tool_count,
                   count(DISTINCT ask.skill_id) AS skill_count
            FROM agents a
            LEFT JOIN agent_tools  ato ON ato.agent_id = a.id
            LEFT JOIN agent_skills ask ON ask.agent_id = a.id
            WHERE a.domain_id=$1
            GROUP BY a.id
            ORDER BY a.created_at DESC
            """,
            domain_id,
        )
    return [dict(r) for r in rows]


async def list_all_agents() -> list[dict]:
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT a.*,
                   d.name AS domain_name,
                   count(DISTINCT ato.tool_id)  AS tool_count,
                   count(DISTINCT ask.skill_id) AS skill_count
            FROM agents a
            JOIN  domains d ON d.id = a.domain_id
            LEFT JOIN agent_tools  ato ON ato.agent_id = a.id
            LEFT JOIN agent_skills ask ON ask.agent_id = a.id
            GROUP BY a.id, d.name
            ORDER BY a.created_at DESC
            """
        )
    return [dict(r) for r in rows]


async def get_agent(domain_id: str, agent_id: str) -> dict | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM agents WHERE id=$1 AND domain_id=$2",
            agent_id,
            domain_id,
        )
        if not row:
            return None
        agent = dict(row)
        agent.pop("litellm_virtual_key", None)

        tools = await conn.fetch(
            """
            SELECT t.id, t.name, t.description, t.endpoint
            FROM tools t
            JOIN agent_tools ato ON ato.tool_id = t.id
            WHERE ato.agent_id=$1
            """,
            agent_id,
        )
        agent["tools"] = [dict(t) for t in tools]

        skills = await conn.fetch(
            """
            SELECT s.id, s.name, s.description, s.pip_package
            FROM skills s
            JOIN agent_skills ask ON ask.skill_id = s.id
            WHERE ask.agent_id=$1
            """,
            agent_id,
        )
        agent["skills"] = [dict(s) for s in skills]

    return agent


async def delete_agent(domain_id: str, agent_id: str) -> bool:
    settings = get_settings()

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT litellm_virtual_key FROM agents WHERE id=$1 AND domain_id=$2",
            agent_id,
            domain_id,
        )
    if not row:
        return False

    if row["litellm_virtual_key"]:
        try:
            virtual_key = decrypt_virtual_key(row["litellm_virtual_key"])
            async with httpx.AsyncClient(timeout=15) as client:
                await client.request(
                    "DELETE",
                    f"{settings.atom_llm_url}/atom/deprovision_agent",
                    json={"virtual_key": virtual_key},
                )
        except Exception:
            pass

    async with get_conn() as conn:
        await conn.execute(
            "UPDATE agents SET status='suspended', updated_at=now() WHERE id=$1",
            agent_id,
        )

    return True
