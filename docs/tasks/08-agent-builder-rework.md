# Session 08 — Agent Builder Rework

## Scope

Three interrelated change areas:

1. **New agent creation flow** — step-by-step provisioning (LiteLLM key at create time), tools registry (global vs agent-specific), skills (agent-specific), LLM-generated spec+role, immutable version history
2. **MinIO as primary storage** — specs and role markdowns stored in MinIO, no local disk
3. **GATE direct agent invocation** — GATE queries platform-db for container URL, calls agent container directly (bypasses builder-backend for `/invoke`)
4. **HMAC-signed audit logs** — every audit event gets an `_hmac: hmac-sha256:{sig}` field so logs cannot be silently tampered
5. **CLI cookiecutter scaffold** — interactive `atom agent scaffold` that asks questions, generates actual runnable Python code, and registers the agent locally so GATE can route to it
6. **Tools Registry** — global tools (reusable across agents) managed in a separate `/tools` API + UI page; agent-specific tools scoped to one agent

## New agent creation flow (4 steps)

```
Step 1 — Provision
  POST /agents  {name, description}
  → DB record created (status: provisioned)
  → LiteLLM virtual key issued immediately with defaults (no tools yet)

Step 2 — Tools & Skills
  POST /agents/{name}/tools  — create agent-specific tool
  POST /agents/{name}/tools/associate  — link a global tool
  DELETE /agents/{name}/tools/{tool_id}
  POST /agents/{name}/skills  — upsert skill (markdown)
  DELETE /agents/{name}/skills/{skill_name}
  → LiteLLM key updated (PATCH /key/update) each time tool list changes

Step 3 — Generate
  POST /agents/{name}/generate  {behavior}
  → LLM (Gemini via LiteLLM) produces role markdown + spec YAML
  → Saved as draft to MinIO: specs/agents/{name}/draft/spec.yaml + role.md
  → status: draft

Step 4 — Deploy
  POST /agents/{name}/deploy-direct  (or deploy-request for approval flow)
  → Reads draft from MinIO
  → Compiles agent.py via LLM
  → Containers built + started
  → Immutable version minted: specs/agents/{name}/versions/{n}/spec.yaml
  → status: deployed, version_count: n
```

**Edit deployed agent**: same 4 steps but draft is created from latest deployed version; deploy bumps n.

## Tools Registry

```
Global tools  (scope=global, owner_agent=null)
  GET    /tools              — list all global tools
  POST   /tools              — create global tool
  PUT    /tools/{tool_id}    — update global tool
  DELETE /tools/{tool_id}    — delete global tool

Agent-specific tools  (scope=agent, owner_agent={name})
  Created via POST /agents/{name}/tools  with scope=agent
  Visible only to that agent

Agent ↔ tool associations (agent_tools join table)
  Tracks which global tools an agent has opted in to
  POST /agents/{name}/tools/associate  {tool_id}
  DELETE /agents/{name}/tools/{tool_id}
```

## MinIO path structure

```
Bucket: specs
  agents/{name}/draft/spec.yaml         ← mutable, overwritten on each generate
  agents/{name}/draft/role.md           ← mutable
  agents/{name}/versions/{n}/spec.yaml  ← immutable on deploy
  agents/{name}/versions/{n}/role.md    ← immutable on deploy
```

## HMAC audit signing

All audit events written anywhere (GATE Go, builder-backend Python, workflow-backend Python) get:
```json
{ ...event_fields..., "_hmac": "hmac-sha256:{hex}" }
```
The HMAC-SHA256 is computed over the canonical JSON of the other fields (sorted keys).
Key: env var `AUDIT_HMAC_KEY` (default: `atom-audit-hmac-key-change-in-prod`).

## GATE direct agent invocation

- `POST /agents/{name}/invoke` → GATE queries platform-db for `endpoint` where `name=$1 AND status='deployed'`
- Forwards POST body to `{endpoint}/invoke`, streams response back
- Pre/post audit events written as before (gate_run_id, actor, phase=pre/post)
- Builder-backend `/agents/{name}/invoke` route becomes dead code (kept for backward compat during transition)
- GATE: new `db.go` (pgx pool), new `agent_invoke.go` (handler)
- `go.mod` gains `github.com/jackc/pgx/v5`

## CLI interactive scaffold

`atom agent scaffold <name>` becomes interactive:

```
Domain [general]:
Short description:
Fetching tools from registry...
Select global tools to include (space to toggle, enter to confirm): [multi-select]
Add agent-specific tools? [y/N]:
  (if y) Tool name: / Description: / Endpoint URL: / Method [POST]:  (repeat)
Describe agent behavior (how it should reason, when to use each tool):
Local port to run on [8090]:

→ Creates agents/<name>/
    agent.py          — real AgentScope code, editable
    spec.yaml         — pre-filled spec
    agent-role.md     — generated role markdown
    Dockerfile
    requirements.txt
    .env.example
    README.md

→ Calls POST /agents/<name>/register-local {endpoint: http://host.docker.internal:<port>}
   to insert a 'deployed' record into platform-db so GATE routes to it.

Run locally:
  cd agents/<name> && pip install -r requirements.txt && python agent.py
```

## Files changed

### builder-backend
- `app/core/registry_db.py` — add `tools`, `agent_tools` tables; new columns on `agents`
- `app/core/minio_store.py` (**new**) — draft + versioned spec/role read/write
- `app/core/identity.py` — `provision_identity(name, owner)`, `update_identity_tools(vkey, names)`
- `app/core/litellm_client.py` — `update_virtual_key(key, metadata)`
- `app/core/audit.py` — HMAC signing on every `emit`
- `app/routes/tools.py` (**new**) — tools registry CRUD
- `app/routes/agents.py` — reworked: provision, tools, skills, generate, deploy, register-local
- `app/main.py` — register tools router

### gate
- `go.mod` — add `jackc/pgx/v5`
- `config.go` — add `DatabaseURL`, `HMACKey`
- `db.go` (**new**) — pgx pool, `GetAgentEndpoint(name)`
- `agent_invoke.go` (**new**) — direct invoke handler
- `audit.go` — add HMAC signing to `Write`
- `main.go` — wire direct invoke; pass DB to builder gate

### cli
- `atom.py` — `agent scaffold` becomes interactive cookiecutter; new `register-local` sub-command

### frontend
- `src/pages/tools/Registry.tsx` (**new**) — global tools CRUD page
- `src/pages/agents/Builder.tsx` — 4-step wizard (Provision → Tools/Skills → Generate → Deploy)
- `src/api/builder.ts` — new endpoints: provision, tools, skills, generate, register-local, tools registry
- `src/App.tsx` — add `/tools` route
- `src/components/Sidebar.tsx` — add Tools Registry under AGENTS group

## DoD checklist

- [ ] `POST /agents` provisions LiteLLM key + DB record (status=provisioned)
- [ ] `POST /agents/{name}/tools` / `DELETE` / `associate` update LiteLLM tool allowlist
- [ ] `POST /agents/{name}/generate` saves draft spec+role to MinIO
- [ ] No local disk reads/writes for specs or roles; all through MinIO
- [ ] Deploy reads MinIO draft, mints immutable versioned copy
- [ ] Deployed versions immutable; edit creates new draft on same key
- [ ] Global tools CRUD at `/tools`; agent-specific scoped to agent
- [ ] Every audit event has `_hmac` field (Python + Go)
- [ ] `POST /agents/{name}/invoke` handled in GATE directly (queries platform-db)
- [ ] `POST /agents/{name}/register-local` endpoint working
- [ ] `atom agent scaffold` interactive + generates runnable code + registers locally
- [ ] Tools Registry page in frontend
- [ ] 4-step wizard in frontend end-to-end
- [ ] Existing deployed agents continue to work (backward compat on GATE invocation)

---

## Part C — Tool type expansion (appended 2026-05-16)

### Three tool types
- `http` — existing REST call with full auth support
- `python` — inline Python code executed in a subprocess sandbox (`def run(input) -> dict`)
- `mcp` — Model Context Protocol server (SSE transport, official `mcp` SDK)

### Auth mechanisms (all types)
`none` | `api_key` (header or query) | `bearer` | `basic` | `oauth2` (client_credentials / authorization_code with token cache)

### New files
- `app/core/tool_executor.py` — unified executor, OAuth token cache
- `src/components/ToolFormDialog.tsx` — reusable 3-section tool dialog (Basic Info / Type+Config / Auth)

### DoD additions
- [x] `tool_type`, `code`, `mcp_server_url`, `mcp_transport`, `mcp_tool_names`, `auth_config` columns on `tools` table
- [x] `POST /tools/{id}/execute` — runs tool inline (test/debug)
- [x] `POST /tools/{id}/validate-code` — syntax checks Python code
- [x] Python tool sandbox executes `def run(input) -> dict` in subprocess
- [x] OAuth 2.0 token cache with 30s expiry buffer
- [x] Frontend: TypeChip (HTTP/Python/MCP), Test Tool dialog in Registry, ToolFormDialog reused in Builder

---

## Part D — Session management + ReMe memory + Swagger export (appended 2026-05-16)

### Problem
Agent invocations are currently stateless — each `POST /agents/{name}/invoke` is independent. Multi-turn conversations lose context. Long-term memory (ReMe) is configured but not wired into invocation.

### Design

**Session lifecycle:**
```
POST /agents/{name}/sessions                → create session, query ReMe for context, {session_id}
POST /agents/{name}/sessions/{id}/messages  → send message (history injected, ReMe context prepended)
GET  /agents/{name}/sessions/{id}           → full session with messages
GET  /agents/{name}/sessions                → list sessions (for UI)
DELETE /agents/{name}/sessions/{id}         → end session, trigger ReMe summary write
```

**Memory model (two layers):**
- **Within session** — conversation history in platform-db (`session_messages` table), injected as `messages` array per turn
- **Cross-session** — ReMe stores summaries/facts. On new session: retrieve top-K memories. On session end: background summarise → write to ReMe

**Agent containers remain stateless** — builder-backend assembles the full enriched payload (history + ReMe context) before forwarding to the agent container's `/invoke`. Agent sees one structured call per turn, not sessions.

**Swagger / OpenAPI export:**
- GATE proxies `GET /agents/{name}/openapi.json` → `{container_endpoint}/openapi.json` (FastAPI auto-generates this)
- Builder-backend `GET /agents/{name}/swagger` returns the same, plus metadata
- Frontend: "API Docs" tab on agent detail with SwaggerUI component + "Download JSON" button

### DB additions
```sql
CREATE TABLE IF NOT EXISTS agent_sessions (
    session_id   TEXT PRIMARY KEY,
    agent_name   TEXT NOT NULL,
    owner        TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    status       TEXT DEFAULT 'active',
    reme_context TEXT,          -- serialised ReMe memories injected at session start
    metadata     JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS session_messages (
    message_id   TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    role         TEXT NOT NULL,   -- user | assistant | system
    content      TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    run_id       TEXT,
    metadata     JSONB DEFAULT '{}'
);
```

### New files
- `app/routes/sessions.py` — all session endpoints
- `app/core/reme_client.py` — retrieve + summarise calls to ReMe service
- GATE: pass-through for `GET /agents/{name}/openapi.json`
- Frontend: `src/pages/agents/Detail.tsx` — add "Sessions" tab + "API Docs" tab

### DoD
- [ ] Session created → ReMe queried → `reme_context` stored in DB
- [ ] Session message → history loaded → ReMe context prepended → agent called → response persisted
- [ ] Session end → ReMe summarise called in background
- [ ] `GET /agents/{name}/openapi.json` via GATE returns container's OpenAPI spec
- [ ] Frontend: create session, send messages, see history, view API docs, download JSON
