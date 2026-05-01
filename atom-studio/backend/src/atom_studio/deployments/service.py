import hashlib
import json
import logging

import httpx

log = logging.getLogger(__name__)

from ..config import get_settings
from ..kafka_producer import emit as kafka_emit

# atom-runtime URL can be overridden at runtime via /api/runtime/register
_runtime_url: str | None = None


def register_runtime_url(url: str) -> None:
    global _runtime_url
    _runtime_url = url


def get_runtime_url() -> str:
    return _runtime_url or get_settings().atom_runtime_url


async def submit_deployment(
    agent_id: str,
    image: str,
    git_sha: str | None,
    message: str | None,
    submitted_by: str,
    conn,
) -> dict:
    manifest = {"image": image, "git_sha": git_sha, "message": message}

    deployment = await conn.fetchrow(
        """
        WITH v AS (
            SELECT COALESCE(MAX(version), 0) + 1 AS next_version
            FROM deployments WHERE agent_id = $1
        )
        INSERT INTO deployments (agent_id, version, manifest_json, status, submitted_by)
        SELECT $1, next_version, $2::jsonb, 'pending', $3
        FROM v
        RETURNING *
        """,
        agent_id,
        json.dumps(manifest),
        submitted_by,
    )

    await conn.execute(
        "UPDATE agents SET status='pending_approval', updated_at=now() WHERE id=$1",
        agent_id,
    )

    from ..hitl.service import create_hitl_request

    await create_hitl_request(
        agent_id=agent_id,
        workflow_type="DEPLOYMENT_APPROVAL",
        payload={
            "deployment_id": str(deployment["id"]),
            "image": image,
            "git_sha": git_sha,
            "message": message,
        },
        timeout_s=86400,
        conn=conn,
    )

    await kafka_emit(
        "atom.deployments",
        {
            "event": "deployment_submitted",
            "deployment_id": str(deployment["id"]),
            "agent_id": agent_id,
            "version": deployment["version"],
            "image": image,
            "git_sha": git_sha,
            "submitted_by": submitted_by,
        },
    )
    return dict(deployment)


async def trigger_deployment(hitl_payload: dict, conn) -> None:
    """
    Call atom-runtime to start the k8s rollout after HITL approval.

    Issues a fresh agent JWT for the deployment pod, stores its hash so GATE
    can validate it, and passes the raw JWT to atom-runtime which stores it in
    a k8s Secret (ATOM_AGENT_JWT env var in the pod).
    """
    deployment_id = hitl_payload["deployment_id"]

    agent_row = await conn.fetchrow(
        """
        SELECT a.id, a.domain_id, a.memory_config_id
        FROM agents a
        JOIN deployments d ON d.agent_id = a.id
        WHERE d.id = $1
        """,
        deployment_id,
    )
    if not agent_row:
        return

    manifest_raw = await conn.fetchval(
        "SELECT manifest_json FROM deployments WHERE id=$1", deployment_id
    )
    manifest = manifest_raw if isinstance(manifest_raw, dict) else json.loads(manifest_raw or "{}")

    # Issue a fresh JWT for the production pod and record its hash.
    # This revokes the current token so only the pod's JWT is valid.
    from ..agents.service import issue_agent_jwt

    agent_jwt = issue_agent_jwt(str(agent_row["id"]), str(agent_row["domain_id"]))
    token_hash = hashlib.sha256(agent_jwt.encode()).hexdigest()
    # Revoke existing pod tokens (previous deployments); client tokens are untouched.
    await conn.execute(
        "UPDATE agent_tokens SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL AND token_type='pod'",
        agent_row["id"],
    )
    await conn.execute(
        "INSERT INTO agent_tokens (agent_id, token_hash, token_type) VALUES ($1,$2,'pod')",
        agent_row["id"],
        token_hash,
    )

    await kafka_emit(
        "atom.deployments",
        {
            "event": "deployment_approved",
            "deployment_id": deployment_id,
            "agent_id": str(agent_row["id"]),
            "image": manifest.get("image") or hitl_payload.get("image"),
        },
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f"{get_runtime_url()}/runtime/deploy",
                json={
                    "deployment_id": deployment_id,
                    "agent_id": str(agent_row["id"]),
                    "domain_id": str(agent_row["domain_id"]),
                    "image": manifest.get("image") or hitl_payload.get("image"),
                    "memory_config_id": (
                        str(agent_row["memory_config_id"])
                        if agent_row["memory_config_id"]
                        else None
                    ),
                    "agent_jwt": agent_jwt,
                },
            )
    except Exception as exc:
        log.error(
            "trigger_deployment: atom-runtime call failed for deployment %s — %s",
            deployment_id,
            exc,
        )
