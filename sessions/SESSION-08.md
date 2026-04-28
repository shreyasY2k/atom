# SESSION-08 — atom-studio: Agent Provisioning

**Prerequisites:** SESSION-07 complete (auth + domains working)
**Goal:** Build the full agent creation and provisioning flow — backend APIs and frontend wizard.
**Estimated time:** 2 days

---

## Context

This session wires together the most important flow in ATOM: creating an agent identity,
provisioning it an LLM virtual key from atom-llm, generating its one-time JWT, and
scaffolding the project on the developer's machine via `atom create agent <token>`.

The agent creation flow spans three services:
1. **atom-studio backend** — orchestrates everything
2. **atom-llm** — provisions LiteLLM virtual key
3. **Postgres** — stores agent record, token hash, junction tables

---

## Part 1 — Backend

### 1. Agents module (`src/atom_studio/agents/`)

**`router.py`** — endpoints:

```
GET    /api/domains/{domain_id}/agents              list agents in domain
POST   /api/domains/{domain_id}/agents              create agent (full flow below)
GET    /api/domains/{domain_id}/agents/{agent_id}   get agent detail + config
PATCH  /api/domains/{domain_id}/agents/{agent_id}   update config (draft only)
DELETE /api/domains/{domain_id}/agents/{agent_id}   soft-delete
POST   /api/domains/{domain_id}/agents/{agent_id}/regenerate-token
GET    /api/domains/{domain_id}/agents/{agent_id}/token-status
```

**`service.py`** — agent creation flow:

```python
async def create_agent(domain_id, payload, current_user, conn) -> tuple[AgentRecord, str]:
    """
    Returns (agent_record, raw_jwt).
    raw_jwt is returned ONCE and never stored. Caller must show it to the user.
    """
    # Step 1: Insert agent record (status=draft)
    agent = await conn.fetchrow("""
        INSERT INTO agents (domain_id, owner_id, name, description,
                            hitl_timeout_seconds, hitl_fallback)
        VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    """, domain_id, current_user["sub"], payload.name, payload.description,
        payload.hitl_timeout_seconds, payload.hitl_fallback)

    # Step 2: Provision LiteLLM virtual key from atom-llm
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.atom_llm_url}/atom/provision_agent",
            json={"agent_id": str(agent["id"]),
                  "allowed_models": payload.allowed_models,
                  "rpm_limit": payload.rpm_limit,
                  "tpm_limit": payload.tpm_limit}
        )
        resp.raise_for_status()
        virtual_key = resp.json()["virtual_key"]

    # Step 3: Encrypt virtual key at rest (AES-GCM)
    encrypted_key = encrypt_aes_gcm(virtual_key, settings.atom_encryption_key)
    await conn.execute(
        "UPDATE agents SET litellm_virtual_key=$1 WHERE id=$2",
        encrypted_key, agent["id"]
    )

    # Step 4: Generate RS256 agent JWT (signed with platform private key)
    raw_jwt = create_agent_token(
        agent_id=str(agent["id"]),
        domain_id=str(domain_id),
    )
    # payload: { sub: "agent-{id}", type: "agent", agent_id, domain_id, iss: "atom-studio" }
    # No expiry — agent tokens are revoked explicitly, not by time

    # Step 5: Store token hash (for revocation lookups in GATE)
    token_hash = hashlib.sha256(raw_jwt.encode()).hexdigest()
    await conn.execute("""
        INSERT INTO agent_tokens (agent_id, token_hash) VALUES ($1, $2)
    """, agent["id"], token_hash)

    # Step 6: Wire tools, skills, policies
    for tool_id in payload.tool_ids:
        await conn.execute(
            "INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1, $2)",
            agent["id"], tool_id
        )
    for skill_id in payload.skill_ids:
        await conn.execute(
            "INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2)",
            agent["id"], skill_id
        )
    for policy_id in payload.policy_ids:
        await conn.execute(
            "INSERT INTO agent_policies (agent_id, policy_id) VALUES ($1, $2)",
            agent["id"], policy_id
        )

    # Step 7: Create memory config if specified
    if payload.memory_config:
        mem_id = await conn.fetchval("""
            INSERT INTO memory_configs (short_term_ttl_s, max_vectors, embedding_model)
            VALUES ($1, $2, $3) RETURNING id
        """, payload.memory_config.short_term_ttl_s,
            payload.memory_config.max_vectors,
            payload.memory_config.embedding_model)
        await conn.execute(
            "UPDATE agents SET memory_config_id=$1 WHERE id=$2",
            mem_id, agent["id"]
        )

    return agent, raw_jwt
```

**Token regeneration flow:**
```python
async def regenerate_token(agent_id, current_user, conn) -> str:
    # 1. Revoke old token: UPDATE agent_tokens SET revoked_at=now()
    # 2. Set Redis key token_revoked:{old_hash} = 1 EX 86400
    #    (GATE checks Redis first — propagates within milliseconds)
    # 3. Generate and store new token
    # 4. Return new raw_jwt (shown once)
```

### 2. Tools module (`src/atom_studio/tools/router.py`)

```
GET  /api/tools        list available tools
POST /api/tools        register new tool { name, endpoint, schema_json, description }
GET  /api/tools/{id}
```

### 3. Skills module (`src/atom_studio/skills/router.py`)

```
GET  /api/skills
POST /api/skills       register { name, pip_package, description }
GET  /api/skills/{id}
```

### 4. Add all routers to `main.py`

```python
from .agents.router import router as agents_router
from .tools.router import router as tools_router
from .skills.router import router as skills_router

app.include_router(agents_router, prefix="/api/domains/{domain_id}/agents", tags=["agents"])
app.include_router(tools_router,  prefix="/api/tools",  tags=["tools"])
app.include_router(skills_router, prefix="/api/skills", tags=["skills"])
```

---

## Part 2 — Frontend

### 5. Agent creation wizard (`src/pages/AgentWizard.tsx`)

7-step wizard using shadcn Card + stepper pattern:

| Step | Content |
|---|---|
| 1 | Name + description |
| 2 | Select domain (dropdown of user's domains) |
| 3 | Select tools (checkbox list from GET /api/tools) |
| 4 | Select skills (checkbox list from GET /api/skills) |
| 5 | Memory config: short-term TTL, max vectors, embedding model |
| 6 | HITL settings: timeout_s, fallback (ABORT/CONTINUE/ESCALATE) |
| 7 | Review summary → Create Agent |

### 6. Token reveal modal (`src/components/app/TokenRevealModal.tsx`)

Shown once immediately after successful agent creation:

```
┌─────────────────────────────────────────────────────────┐
│  ⚠  Your agent token — copy it now                      │
│                                                         │
│  This token will never be shown again.                  │
│  Store it securely or use it immediately with:          │
│                                                         │
│  atom create agent eyJhbGciOiJSUzI1NiIs...             │
│  [Copy to clipboard]                                    │
│                                                         │
│  [ I've copied the token — Close ]                      │
└─────────────────────────────────────────────────────────┘
```

The Close button is disabled until "I've copied" checkbox is ticked.
The modal cannot be dismissed by clicking outside.

### 7. Agent detail page (`src/pages/AgentDetail.tsx`)

Shows:
- Agent name, status badge (draft / pending_approval / deployed / suspended)
- Domain name
- Tools list (chip badges)
- Skills list (chip badges)
- Policies list (chip badges)
- Memory config summary
- Deployment history (stub table — wired in SESSION-09)
- HITL history (stub table — wired in SESSION-09)
- Actions: **Deploy** button, **Regenerate Token** button, **Suspend** button

### 8. Agents list page (`src/pages/Agents.tsx`)

Table with: name, domain, status, tools count, last deployed, actions column.
"New Agent" button → navigates to wizard.

---

## Acceptance Criteria

- [ ] `POST /api/domains/{did}/agents` → creates agent, provisions LiteLLM key, returns `{ agent, token }`
- [ ] Agent token validates in GATE: `curl -H "Authorization: Bearer {token}" http://localhost:8080/healthz`
- [ ] `SELECT * FROM agent_tokens WHERE agent_id='{id}'` shows one row with `token_hash` set
- [ ] `SELECT * FROM agent_tools WHERE agent_id='{id}'` has correct junction rows
- [ ] `POST /api/domains/{did}/agents/{id}/regenerate-token` returns new token; old token rejected by GATE within 2s
- [ ] `GET /api/tools` and `GET /api/skills` return lists
- [ ] Frontend wizard completes in 7 steps and shows token reveal modal
- [ ] Token reveal modal cannot be closed without ticking the checkbox
- [ ] Agent detail page shows correct status and configuration
- [ ] `pytest src/tests/test_agents.py` passes

---

## Claude Code Starter Prompt

```
You are implementing SESSION-08 of ATOM — agent provisioning in atom-studio.

Context:
- atom-studio backend (SESSION-07) is running with auth and domains
- atom-llm (SESSION-05) is running with POST /atom/provision_agent endpoint
- Postgres schema includes: agents, agent_tokens, agent_tools, agent_skills,
  agent_policies, tools, skills, memory_configs tables
- RS256 key pair is at .keys/jwt_private.pem and .keys/jwt_public.pem
- Agent tokens: RS256, no expiry, payload { sub:"agent-{id}", type:"agent",
  agent_id, domain_id, iss:"atom-studio" }
- Token hash = sha256(raw_jwt) stored in agent_tokens for GATE revocation checks

Backend tasks:
1. Implement atom-studio/backend/src/atom_studio/agents/service.py with:
   - create_agent(): 7-step flow (insert → provision LiteLLM key → encrypt → issue JWT →
     store token_hash → wire tools/skills/policies → create memory_config)
   - regenerate_token(): revoke old (DB + Redis SET token_revoked:{hash}=1) → issue new
   - AES-GCM encryption helper for LiteLLM virtual keys
2. Implement agents/router.py with all CRUD endpoints
3. Implement tools/router.py and skills/router.py
4. Add all routers to main.py
5. Write tests: create agent → verify token validates in GATE → regenerate → verify old rejected

Frontend tasks:
1. Build 7-step agent creation wizard (shadcn Card + progress indicator)
2. Build token reveal modal (cannot close without checkbox; cannot dismiss outside)
3. Build agent detail page with status, tools/skills chips, Deploy/Regenerate/Suspend buttons
4. Build agents list page with table and "New Agent" button

Key: the raw JWT must only ever be returned once from the API and only displayed once in the UI.
After that, only token_hash is stored and the raw token is unrecoverable.
```
