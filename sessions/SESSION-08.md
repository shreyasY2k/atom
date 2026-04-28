# SESSION-08 — atom-studio: Agent Provisioning

**Prerequisites:** SESSION-07 complete (auth + domains working, LiteLLM team provisioning verified)
**Goal:** Build the full agent creation flow — LiteLLM agent provisioning, one-time JWT issuance, React wizard, and token reveal modal.
**Estimated time:** 2 days

---

## Context

Agent creation spans three services in sequence:

```
atom-studio backend
  → atom-llm  (provision LiteLLM agent scoped to domain's team)
  → Postgres  (store agent + token hash + junction tables)
```

### LiteLLM agent provisioning (via /key/generate — /agent/new was removed in 1.83)

When an agent is created, we call `POST /atom/provision_agent` on atom-llm.
This creates a **LiteLLM key** scoped to the domain's team with:
- Its own virtual key (`sk-...`)
- Model restrictions (allowed_models)
- Rate limits (rpm/tpm)
- Guardrails (if specified)

atom-studio never calls LiteLLM directly. The ATOM abstraction layer
(`POST /atom/provision_agent`) internally calls `POST /key/generate` with `team_id`.
**LiteLLM 1.83 removed `/agent/new`** in favour of team-scoped keys. The returned
`litellm_agent_id` is the `token_id` of the generated key, not an agent-object ID.

The `litellm_team_id` must already exist on the domain (set during domain creation in
SESSION-07). If it is null, agent creation fails immediately with 400.

### Token issuance

After LiteLLM provisioning, atom-studio issues the agent's RS256 JWT using the platform
private key — the same key GATE uses for validation. This token is:
- Returned **once** in the API response and shown once in the UI
- Never stored raw anywhere — only `sha256(token)` goes to Postgres
- Has no expiry — revoked explicitly via `agent_tokens.revoked_at`

### Developer workflow context

Developers scaffold and iterate on agents using `atom create` (SESSION-10), which generates
a local project that runs in **dev mode** (calls LiteLLM directly, no GATE or token needed).
The token issued here is only needed when the developer is ready to switch to **prod mode**
(routing through GATE). They set it as `ATOM_AGENT_JWT` in their agent project's `.env`.

---

## Part 1 — Backend

### 1. Migration for litellm_agent_id

Verify migration `000008_litellm_ids.up.sql` has been run:

```bash
psql $DATABASE_URL -c "\d agents" | grep litellm
# Should show both litellm_virtual_key and litellm_agent_id columns
```

If not: `make migrate-up`

### 2. Agents module (`src/atom_studio/agents/`)

**`service.py`** — full create_agent flow:

```python
import hashlib
import secrets
import base64
import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import jwt as jose_jwt
from datetime import datetime, timezone
from ..config import get_settings
from ..database import get_conn


def encrypt_virtual_key(virtual_key: str) -> str:
    """AES-GCM encrypt the LiteLLM virtual key for storage at rest."""
    settings = get_settings()
    key   = bytes.fromhex(settings.atom_encryption_key)
    nonce = secrets.token_bytes(12)
    ct    = AESGCM(key).encrypt(nonce, virtual_key.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_virtual_key(encrypted: str) -> str:
    """Decrypt a stored virtual key."""
    settings = get_settings()
    key  = bytes.fromhex(settings.atom_encryption_key)
    data = base64.b64decode(encrypted)
    return AESGCM(key).decrypt(data[:12], data[12:], None).decode()


def issue_agent_jwt(agent_id: str, domain_id: str) -> str:
    """
    Issue an RS256 JWT for the agent.
    Same key pair as GATE — GATE validates this token on every request.
    No expiry — tokens are revoked explicitly.
    """
    settings = get_settings()
    payload = {
        "sub":       f"agent-{agent_id}",
        "type":      "agent",
        "agent_id":  agent_id,
        "domain_id": domain_id,
        "iss":       "atom-studio",
        "iat":       int(datetime.now(timezone.utc).timestamp()),
    }
    return jose_jwt.encode(payload, settings.jwt_private_key, algorithm="RS256")


async def create_agent(domain_id: str, payload, owner_id: str) -> tuple[dict, str]:
    """
    Create an agent with full provisioning.
    Returns (agent_record, raw_jwt).
    raw_jwt is returned ONCE — caller must show it to the user immediately.
    Never call this function and discard raw_jwt.
    """
    settings = get_settings()

    async with get_conn() as conn:
        async with conn.transaction():

            # Step 1: verify domain has a LiteLLM team
            domain = await conn.fetchrow(
                "SELECT id, litellm_team_id FROM domains WHERE id=$1 AND is_active=true",
                domain_id
            )
            if not domain:
                raise ValueError("Domain not found")
            if not domain["litellm_team_id"]:
                raise ValueError(
                    "Domain has no LiteLLM team — was /atom/provision_domain called? "
                    "Re-create the domain or run provision_domain manually."
                )

            # Step 2: insert agent (status=draft)
            agent = await conn.fetchrow("""
                INSERT INTO agents (domain_id, name, description, status, owner_id,
                                    allowed_models, rpm_limit, tpm_limit, hitl_timeout_s,
                                    hitl_fallback)
                VALUES ($1,$2,$3,'draft',$4,$5,$6,$7,$8,$9)
                RETURNING *
            """, domain_id, payload.name, payload.description, owner_id,
                payload.allowed_models, payload.rpm_limit, payload.tpm_limit,
                payload.hitl_timeout_s, payload.hitl_fallback)

            # Step 3: provision LiteLLM agent
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{settings.atom_llm_url}/atom/provision_agent",
                    json={
                        "agent_id":       str(agent["id"]),
                        "agent_name":     payload.name,
                        "team_id":        str(domain["litellm_team_id"]),
                        "allowed_models": payload.allowed_models,
                        "rpm_limit":      payload.rpm_limit,
                        "tpm_limit":      payload.tpm_limit,
                    },
                    timeout=10.0
                )
                if resp.status_code != 200:
                    raise httpx.HTTPStatusError(
                        f"atom-llm provision_agent failed: {resp.text}",
                        request=resp.request, response=resp
                    )
                litellm_data = resp.json()

            # Step 4: encrypt and store virtual key
            encrypted_key = encrypt_virtual_key(litellm_data["virtual_key"])
            await conn.execute("""
                UPDATE agents
                SET litellm_agent_id=$1, litellm_virtual_key=$2
                WHERE id=$3
            """, litellm_data["litellm_agent_id"], encrypted_key, agent["id"])

            # Step 5: issue RS256 agent JWT
            raw_jwt = issue_agent_jwt(str(agent["id"]), domain_id)
            token_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()

            # Step 6: store token hash (never the raw token)
            await conn.execute("""
                INSERT INTO agent_tokens (agent_id, token_hash)
                VALUES ($1, $2)
            """, agent["id"], token_hash)

            # Step 7: wire tools, skills, policies (junction tables)
            for tool_id in (payload.tool_ids or []):
                await conn.execute(
                    "INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1,$2)",
                    agent["id"], tool_id
                )
            for skill_id in (payload.skill_ids or []):
                await conn.execute(
                    "INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1,$2)",
                    agent["id"], skill_id
                )

            # Step 8: memory config
            if payload.memory_config:
                await conn.execute("""
                    INSERT INTO memory_configs
                        (agent_id, short_term_ttl_s, max_vectors, embedding_model)
                    VALUES ($1,$2,$3,$4)
                """, agent["id"],
                    payload.memory_config.short_term_ttl_s,
                    payload.memory_config.max_vectors,
                    payload.memory_config.embedding_model)

            return dict(agent), raw_jwt


async def regenerate_token(agent_id: str, conn) -> str:
    """
    Revoke current token and issue a new one.
    Old token is blacklisted in Redis for 24h so GATE rejects it immediately.
    """
    import redis.asyncio as aioredis
    from ..config import get_settings
    settings = get_settings()

    # Get and revoke old token
    old = await conn.fetchrow(
        "SELECT token_hash FROM agent_tokens WHERE agent_id=$1 AND revoked_at IS NULL",
        agent_id
    )
    if old:
        await conn.execute(
            "UPDATE agent_tokens SET revoked_at=now() WHERE agent_id=$1 AND revoked_at IS NULL",
            agent_id
        )
        r = aioredis.from_url(settings.redis_url)
        await r.set(f"token_revoked:{old['token_hash']}", "1", ex=86400)
        await r.aclose()

    # Issue new token
    agent = await conn.fetchrow("SELECT domain_id FROM agents WHERE id=$1", agent_id)
    raw_jwt = issue_agent_jwt(agent_id, str(agent["domain_id"]))
    token_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()
    await conn.execute(
        "INSERT INTO agent_tokens (agent_id, token_hash) VALUES ($1,$2)",
        agent_id, token_hash
    )
    return raw_jwt
```

### 3. Tools and Skills routers

Add to `src/atom_studio/tools/router.py`:
```
GET  /api/tools
POST /api/tools        { name, endpoint, schema_json, description }
GET  /api/tools/{id}
```

Add to `src/atom_studio/skills/router.py`:
```
GET  /api/skills
POST /api/skills       { name, pip_package, description }
GET  /api/skills/{id}
```

### 4. Wire all routers in main.py

```python
from .agents.router import router as agents_router
from .tools.router  import router as tools_router
from .skills.router import router as skills_router

app.include_router(agents_router, prefix="/api/domains/{domain_id}/agents", tags=["agents"])
app.include_router(tools_router,  prefix="/api/tools",   tags=["tools"])
app.include_router(skills_router, prefix="/api/skills",  tags=["skills"])
```

---

## Part 2 — Frontend

### 5. Agent creation wizard (`src/pages/AgentWizard.tsx`)

7-step wizard. Each step is a shadcn Card. Progress shown as step indicators at the top.

| Step | Fields |
|---|---|
| 1 | Agent name (required), description |
| 2 | Domain selection (dropdown from GET /api/domains) |
| 3 | Allowed models (checkboxes: gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514, gemini-2.5-flash) |
| 4 | Tools (checkboxes from GET /api/tools) |
| 5 | Skills (checkboxes from GET /api/skills) |
| 6 | Memory: short_term_ttl_s (slider 60–86400), max_vectors (input), embedding_model |
| 7 | HITL: timeout_s (default 300), fallback (ABORT/CONTINUE/ESCALATE select) + review summary |

Final step shows a full summary before submission. "Create Agent" button calls
`POST /api/domains/{domain_id}/agents`.

### 6. Token reveal modal (`src/components/app/TokenRevealModal.tsx`)

Shown immediately after successful agent creation. Cannot be dismissed any other way.

```
┌──────────────────────────────────────────────────────────────────┐
│  ⚠  Copy your agent token now                                    │
│                                                                  │
│  This token is shown exactly once and cannot be recovered.       │
│  It is your agent's credential for prod mode — set it as         │
│  ATOM_AGENT_JWT in your agent project's .env file.               │
│                                                                  │
│  eyJhbGciOiJSUzI1NiIs...                                         │
│  [━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━] [Copy]       │
│                                                                  │
│  To use in your agent project:                                   │
│    ATOM_MODE=prod                                                │
│    ATOM_AGENT_JWT=<this token>                                   │
│    ATOM_GATE_URL=http://<your-gate>:8080                         │
│                                                                  │
│  ☐  I have copied the token and stored it securely              │
│                                                                  │
│  [ Close ]  ← disabled until checkbox is ticked                 │
└──────────────────────────────────────────────────────────────────┘
```

Implementation notes:
- `onOpenChange` is blocked — user cannot click outside to dismiss
- Close button disabled until checkbox is checked
- `navigator.clipboard.writeText()` on Copy button
- Do NOT display `atom create agent <token>` — that command no longer exists.
  The developer scaffolds their project with `atom create` (offline wizard, no token needed).
  The token is only needed when switching `ATOM_MODE=prod` in an existing project.
- After close, navigate to `/domains/{domain_id}/agents/{agent_id}`

### 7. Agent detail page (`src/pages/AgentDetail.tsx`)

Shows:
- Agent name + status badge: `draft` / `pending_approval` / `deployed` / `suspended`
- Domain name (link back)
- Allowed models (badges)
- Tools list (badges)
- Skills list (badges)
- HITL settings: timeout + fallback
- Memory config summary
- Action buttons:
  - **Deploy** → triggers SESSION-09 approval flow (disabled if already deployed)
  - **Regenerate Token** → confirmation dialog, then calls regenerate-token endpoint,
    shows new token in reveal modal (same modal, same copy instructions)
  - **Suspend** → calls DELETE endpoint

Deployment history and HITL history tables are stubs here — wired in SESSION-09.

### 8. Agents list page (`src/pages/Agents.tsx`)

Table: Name, Domain, Status (badge), Models, Tools count, Last deployed, Actions.
"New Agent" → navigate to wizard.
Click row → agent detail.

### 9. Enable Agents in sidebar

In `Layout.tsx`, re-enable the Agents sidebar item (it was disabled in SESSION-07).

---

## Acceptance Criteria

- [ ] `POST /api/domains/{did}/agents` → full provisioning chain completes
- [ ] `SELECT litellm_agent_id FROM agents WHERE name='test-agent'` → non-null
- [ ] `GET http://localhost:4000/key/info?key_id={litellm_agent_id}` → key exists in LiteLLM, scoped to domain team
- [ ] Agent JWT validates in GATE:
  ```bash
  curl -H "Authorization: Bearer {raw_jwt}" http://localhost:8080/healthz
  # → 200
  ```
- [ ] LLM call through GATE with agent JWT works:
  ```bash
  curl -X POST http://localhost:8080/domain/{did}/agent/{aid}/v1/chat/completions \
    -H "Authorization: Bearer {raw_jwt}" \
    -H "Content-Type: application/json" \
    -d '{"model":"gpt-4o","messages":[{"role":"user","content":"say hi"}]}'
  ```
- [ ] `SELECT token_hash FROM agent_tokens WHERE agent_id='{id}'` → one row, revoked_at is null
- [ ] `regenerate-token` endpoint: old token rejected by GATE within 2s, new token accepted
- [ ] If atom-llm is down, `POST /api/domains/{did}/agents` returns 502 and agent is NOT in Postgres
- [ ] Domain with null `litellm_team_id` → agent creation returns 400
- [ ] Frontend wizard completes in 7 steps
- [ ] Token reveal modal shows token + prod-mode `.env` instructions (NOT `atom create agent <token>`)
- [ ] Token reveal modal cannot be closed without ticking checkbox
- [ ] Token reveal modal cannot be dismissed by clicking outside
- [ ] `pytest src/tests/test_agents.py` passes

---

## Claude Code Starter Prompt

```
You are implementing SESSION-08 of ATOM — agent provisioning in atom-studio.

Context:
- SESSION-07 is complete: auth + domains working, LiteLLM teams provisioned on domain creation
- domains.litellm_team_id is set for all domains
- agents.litellm_agent_id column exists (migration 000008)
- .keys/jwt_private.pem and .keys/jwt_public.pem exist
- atom-llm is running with /atom/provision_agent endpoint

Developer workflow note:
  Developers use `atom create` (SESSION-10) to scaffold agent projects locally.
  atom create is a purely offline cookiecutter-style wizard — it does NOT require a token.
  The token issued here is only needed when the developer switches their project to
  ATOM_MODE=prod. They paste it as ATOM_AGENT_JWT in their .env file.
  Do NOT reference `atom create agent <token>` anywhere in the UI — that command does not exist.

LiteLLM mapping (important):
  ATOM Domain → LiteLLM Team  (domain.litellm_team_id = domain.id)
  ATOM Agent  → LiteLLM Key   (POST /atom/provision_agent → internally POST /key/generate with team_id)
  litellm_agent_id = token_id returned by /key/generate (NOT an /agent/new ID — that endpoint is gone in 1.83)
  Always go via /atom/provision_agent, never call /key/generate or /agent/new directly

Backend tasks:

1. Implement atom_studio/agents/service.py:
   create_agent():
     - Verify domain.litellm_team_id is set (400 if not)
     - INSERT agent (status=draft) inside a transaction
     - POST atom-llm /atom/provision_agent with team_id=domain.litellm_team_id
     - AES-GCM encrypt virtual_key (ATOM_ENCRYPTION_KEY env var, hex-encoded 32 bytes)
     - UPDATE agents SET litellm_agent_id, litellm_virtual_key
     - Issue RS256 agent JWT: { sub:"agent-{id}", type:"agent", agent_id, domain_id, iss:"atom-studio" }
     - sha256(raw_jwt) → INSERT agent_tokens
     - INSERT agent_tools, agent_skills, agent_policies junction rows
     - INSERT memory_configs if specified
     - Return (agent_dict, raw_jwt)
   regenerate_token():
     - Revoke old token: UPDATE agent_tokens SET revoked_at=now()
     - SET Redis key "token_revoked:{old_hash}" = "1" EX 86400
     - Issue and store new token
     - Return new raw_jwt

2. Implement agents/router.py — all CRUD endpoints
   DELETE must call DELETE /atom/deprovision_agent on atom-llm

3. Implement tools/router.py and skills/router.py (GET + POST each)

4. Wire all new routers in main.py

5. Write tests in src/tests/test_agents.py

Frontend tasks:

6. 7-step agent creation wizard (shadcn Card + step indicator)

7. Token reveal modal — important copy requirements:
   - Show the raw JWT token in a copyable field
   - Instruction text: "Set this as ATOM_AGENT_JWT in your agent project's .env file"
   - Show the three env vars the developer needs: ATOM_MODE=prod, ATOM_AGENT_JWT=<token>,
     ATOM_GATE_URL=http://<your-gate>:8080
   - Do NOT show "atom create agent <token>" — that command does not exist
   - Cannot dismiss outside, close disabled until checkbox ticked

8. Agent detail page — status badge, config display, Deploy/Regenerate/Suspend buttons
9. Agents list page — table with status badges, New Agent button
10. Enable Agents in Layout sidebar

After completing, run the full chain test:
  1. Create domain → verify litellm_team_id set
  2. Create agent → verify litellm_agent_id set + virtual_key encrypted in DB
  3. Verify LiteLLM key exists: GET /key/info?key_id={litellm_agent_id}
  4. Use agent JWT to make LLM call through GATE → should return LLM response
  5. Regenerate token → verify old token rejected by GATE, new token accepted
```
