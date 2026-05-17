# Atom Agent Platform

> Build auditable, deployable agents from versioned specs — and compose them into existing business workflows without rebuilding processes from scratch.

---

## Table of Contents

1. [What is Atom?](#what-is-atom)
2. [Prerequisites](#prerequisites)
3. [Starting from Scratch](#starting-from-scratch)
4. [Creating an Agent (UI)](#creating-an-agent-ui)
5. [Creating an Agent (CLI)](#creating-an-agent-cli)
6. [Creating and Testing Tools](#creating-and-testing-tools)
7. [Sessions and Memory](#sessions-and-memory)
8. [Invoking Agents via API](#invoking-agents-via-api)
9. [HMAC Audit Log Verification](#hmac-audit-log-verification)
10. [Guardrails (AgentArmor)](#guardrails-agentarmor)
11. [Architecture Overview](#architecture-overview)
12. [Service Ports](#service-ports)
13. [Troubleshooting](#troubleshooting)

---

## What is Atom?

Atom has two surfaces:

- **Agent Builder** — create production agents step-by-step: provision identity → add tools & skills → generate spec → deploy
- **Workflow Composer** — load existing business processes as graphs; replace routine human steps with agents while keeping humans at decision boundaries

Every agent gets a **non-human service-account identity** (a LiteLLM virtual key) at creation time. Every LLM call, tool execution, session message, and deployment is captured in a tamper-evident audit trail (HMAC-SHA256 signed, stored in MinIO with 90-day object lock).

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker Desktop | ≥ 4.30 | Compose V2 required |
| `docker compose` | ≥ 2.24 | Ships with Docker Desktop |
| 16 GB RAM | — | First build pulls/compiles AgentScope, ReMe, Studio |
| Python 3.10+ | optional | Only needed if running CLI locally |

You need a **Gemini API key** — set it in the environment or in a `.env` file at the repo root before starting:

```bash
# .env  (create at repo root)
GEMINI_API_KEY=your-gemini-api-key-here
LITELLM_MASTER_KEY=sk-atom-demo-master-2024   # change in production
AUDIT_HMAC_KEY=atom-audit-hmac-key-change-in-prod   # change in production
```

---

## Starting from Scratch

### Clean start (wipes all data)

```bash
# Stop everything and remove all volumes
docker compose down -v --remove-orphans

# Remove any standalone agent containers
docker ps -a --format "{{.Names}}" | grep "^agent-" | xargs -r docker rm -f

# Build all images (10-15 min on first run)
docker compose build --parallel

# Start all services
docker compose up -d

# Wait for healthy (watch for "Started" messages)
docker compose ps
```

The frontend is available at **http://localhost:5173**

### Verify services are up

```bash
curl http://localhost:8080/health       # builder-backend
curl http://localhost:8080/gate/health  # GATE (port 8080)
curl http://localhost:8082/gate/health  # GATE (port 8082, workflow surface)
```

---

## Creating an Agent (UI)

Navigate to **http://localhost:5173** → login as `builder` → **Agents → Build Agent**

The wizard has 4 steps:

### Step 1 — Basic Info

Fill in:
- **Agent Name**: `customer-qa-agent` *(lowercase, hyphens only, 3-40 chars)*
- **Description**: `Answers customer questions about KYC status and transaction risk`

Click **Create Agent** — this immediately provisions a LiteLLM virtual key and creates a DB record. The agent has an identity before deployment.

### Step 2 — Tools & Skills

**Associate global tools** (select from the Tool Registry):
- `kyc-lookup` — HTTP tool calling the KYC mock service
- `calculate-risk` — Python tool that computes risk scores

**Add an agent-specific skill:**
- Name: `qa-reasoning`
- Content: domain-specific reasoning instructions

### Step 3 — Generate

Describe the agent's behavior:

```
When a customer asks about their account status:
1. Call kyc-lookup with their customer_id to verify KYC status.
2. Call calculate-risk with the transaction amount and country code.
3. Return a summary: KYC status, risk band (LOW/MEDIUM/HIGH), and a recommendation
   (APPROVE, REVIEW, or ESCALATE). Explain your reasoning clearly.
```

Click **Generate** — Gemini Flash generates the agent-role markdown and spec YAML, saved to MinIO as a draft.

### Step 4 — Deploy

Before deploying, you can configure the **AgentArmor Guardrails** toggle (default: ON). When enabled, every LLM request and response for this agent is scanned by AgentArmor. Toggle it off only for trusted, controlled environments.

Review the generated spec and role markdown. Click:
- **Deploy directly** — deploys immediately (admin/approver role)
- **Submit for approval** — creates a pending record for an approver

The agent container is built and started on the Docker network. Status transitions: `provisioned → draft → deploying → deployed`.

---

## Creating an Agent (CLI)

The CLI creates real, runnable Python code — not just a spec stub.

### Install CLI

```bash
pip install -e cli/
```

### Login

```bash
atom login --as builder
```

### Scaffold a new agent

```bash
atom agent scaffold balance-checker
```

Interactive prompts:
```
Domain [general]: banking
Short description: Checks account balances and transaction history
Describe agent behavior: When asked about an account, look up the balance and
  return a JSON response with account_id, balance, currency, and last_transaction.
Local port [8090]: 8200

Available global tools:
  [1] kyc-lookup    - Look up KYC status
  [2] calculate-risk - Python risk scorer
Select tools [0]: 1,2

Add agent-specific tool? [y/N]: n
Register with GATE now? [y/N]: y
```

This creates `agents/balance-checker/` with:

| File | Purpose |
|------|---------|
| `agent.py` | FastAPI app — edit freely |
| `agent-role.md` | Role/skill instructions |
| `spec.yaml` | Deployment spec |
| `Dockerfile` | Containerize when ready |
| `requirements.txt` | Python deps |
| `.env.example` | Copy to `.env` |
| `README.md` | Agent-specific docs |

### Run locally (Docker)

```bash
# Build container
docker build -t balance-checker-agent agents/balance-checker/

# Get the virtual key issued at scaffold time
VKEY=$(docker exec platform-db psql -U atom -d atom -t \
  -c "SELECT virtual_key FROM agents WHERE name='balance-checker';" | tr -d ' \n')

# Start on the platform network
docker run -d --name balance-checker-local \
  --network atom_agentnet -p 8200:8200 \
  -e "LITELLM_API_KEY=$VKEY" \
  -e LITELLM_BASE_URL=http://litellm:4000/v1 \
  -e SERVICE_ACCOUNT_ID=svc-acct-balance-checker-local \
  -e AGENT_MODEL=gemini-3-flash \
  balance-checker-agent
```

### Register with GATE

```bash
atom agent register-local balance-checker \
  --endpoint http://balance-checker-local:8200
```

GATE now routes `POST /agents/balance-checker/invoke` directly to this container.

### Invoke via API

```bash
curl -X POST http://localhost:8080/agents/balance-checker/invoke \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:human@atom.io" \
  -d '{"text": "What is the balance for account ACC-1042?"}'
```

### List all agents

```bash
atom agent list
```

---

## Creating and Testing Tools

### Tool types

| Type | Use case |
|------|---------|
| `http` | Call a REST API (any method, with auth) |
| `python` | Inline Python function (`def run(input) -> dict`) executed in a subprocess sandbox |
| `mcp` | Model Context Protocol server (SSE transport) |

### Auth mechanisms

| Mechanism | Fields |
|-----------|--------|
| `none` | — |
| `api_key` | `header_name`, `key`, `in` (header/query) |
| `bearer` | `token` |
| `basic` | `username`, `password` |
| `oauth2` | `token_url`, `client_id`, `client_secret`, `scope`, `grant_type` |

### Create a Python tool (API)

```bash
curl -X POST http://localhost:8080/tools \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:builder@atom.io" \
  -d @- << 'EOF'
{
  "name": "calculate-risk",
  "description": "Calculate transaction risk from amount and country",
  "tool_type": "python",
  "code": "def run(input: dict) -> dict:\n    amount = float(input.get('amount', 0))\n    country = input.get('country', 'US')\n    high_risk = ['IR','KP','SY','CU']\n    base = min(1.0, amount / 50000)\n    risk = base * 2.0 if country in high_risk else base\n    risk = min(1.0, risk)\n    band = 'HIGH' if risk > 0.7 else 'MEDIUM' if risk > 0.3 else 'LOW'\n    return {'risk_score': round(risk, 3), 'band': band}"
}
EOF
```

### Create an HTTP tool with API key auth

```bash
curl -X POST http://localhost:8080/tools \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:builder@atom.io" \
  -d @- << 'EOF'
{
  "name": "kyc-lookup",
  "description": "Get KYC profile for a customer",
  "tool_type": "http",
  "endpoint": "http://kyc-svc:8095/profile/CUST-100442",
  "method": "GET",
  "auth_config": {
    "type": "api_key",
    "header_name": "X-API-Key",
    "key": "demo-key-123",
    "in_": "header"
  }
}
EOF
```

### Create an HTTP tool with OAuth 2.0

```bash
curl -X POST http://localhost:8080/tools \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:builder@atom.io" \
  -d @- << 'EOF'
{
  "name": "secure-service",
  "description": "Call a service with OAuth2 client credentials",
  "tool_type": "http",
  "endpoint": "http://internal-service:8100/api/data",
  "method": "POST",
  "auth_config": {
    "type": "oauth2",
    "grant_type": "client_credentials",
    "token_url": "https://auth.example.com/oauth/token",
    "client_id": "my-client-id",
    "client_secret": "my-client-secret",
    "scope": "api:read api:write"
  }
}
EOF
```

### Execute a tool directly (for testing)

```bash
TOOL_ID="<tool_id from creation response>"

# Test Python risk tool
curl -X POST http://localhost:8080/tools/$TOOL_ID/execute \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:builder@atom.io" \
  -d '{"input": {"amount": 45000, "country": "IR"}}'

# Expected: {"tool_id":"...","tool_name":"calculate-risk","result":{"risk_score":1.0,"band":"HIGH"}}
```

### Validate Python tool syntax

```bash
curl -X POST http://localhost:8080/tools/$TOOL_ID/validate-code \
  -H "X-Atom-Actor: user:builder@atom.io"

# Response: {"valid": true, "has_run_function": true}
```

### KYC mock test data

Valid customer IDs in the KYC mock service:

| Customer ID | Name | Risk |
|-------------|------|------|
| CUST-100442 | Margaret Wong | LOW |
| CUST-200119 | David Eisenberg | — |
| CUST-300577 | Aaron Patel | — |

```bash
curl http://localhost:8095/profile/CUST-100442
```

---

## Sessions and Memory

Sessions give agents conversational context. Within a session, full history is injected on each turn. Across sessions, ReMe provides long-term memory summaries keyed by `workspace_id` (entity identifier, e.g. customer ID).

### Create a session

```bash
curl -X POST http://localhost:8080/agents/customer-qa-agent/sessions \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:human@atom.io" \
  -d '{"workspace_id": "CUST-100442"}'

# Response: {session_id, status, reme_context (if prior memories exist)}
```

### Send messages (multi-turn)

```bash
SESSION_ID="sess-..."

# Turn 1
curl -X POST http://localhost:8080/agents/customer-qa-agent/sessions/$SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:human@atom.io" \
  -d '{"text": "What is the KYC status for CUST-100442?", "workspace_id": "CUST-100442"}'

# Turn 2 (agent remembers turn 1)
curl -X POST http://localhost:8080/agents/customer-qa-agent/sessions/$SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:human@atom.io" \
  -d '{"text": "Now check the risk for a $45,000 transfer to Germany.", "workspace_id": "CUST-100442"}'
```

Each turn the agent receives:
- `text` — current user message
- `messages[]` — full conversation history
- `reme_context` — long-term memories from past sessions for this entity

### End a session (writes to long-term memory)

```bash
curl -X DELETE http://localhost:8080/agents/customer-qa-agent/sessions/$SESSION_ID \
  -H "X-Atom-Actor: user:human@atom.io"
```

The conversation is summarised in a background task and written to ReMe. The next session for the same `workspace_id` will retrieve this summary.

### View session history

```bash
# List all sessions for an agent
curl http://localhost:8080/agents/customer-qa-agent/sessions \
  -H "X-Atom-Actor: user:human@atom.io"

# Get a specific session with all messages (works for ended sessions too)
curl http://localhost:8080/agents/customer-qa-agent/sessions/$SESSION_ID \
  -H "X-Atom-Actor: user:human@atom.io"
```

---

## Invoking Agents via API

### Direct invocation (stateless)

```bash
curl -X POST http://localhost:8080/agents/<name>/invoke \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:human@atom.io" \
  -d '{"text": "your prompt here"}'
```

GATE resolves the agent's container URL from platform-db and calls it directly — no builder-backend hop on the hot invocation path.

### Get the agent's OpenAPI spec

```bash
# Via GATE (direct container passthrough, audit-wrapped)
curl http://localhost:8080/agents/<name>/openapi.json

# Via builder-backend (with Atom metadata annotations)
curl http://localhost:8080/agents/<name>/swagger
```

The UI shows an **API Docs** tab on each agent detail page with a rendered API explorer and a Download button.

### X-Atom-Actor header

All requests must carry `X-Atom-Actor: <actor_type>:<actor_id>`:

```bash
-H "X-Atom-Actor: user:alice@example.com"    # human user
-H "X-Atom-Actor: agent:svc-acct-..."         # agent service account (automatic)
-H "X-Atom-Actor: system:automation"          # automated system
```

---

## HMAC Audit Log Verification

Every audit event written by the platform carries `"_hmac": "hmac-sha256:{hex}"`. The signature covers the canonical (sorted-key) JSON using HMAC-SHA256 with key `AUDIT_HMAC_KEY`.

Events are stored in MinIO `audit-logs` bucket with 90-day COMPLIANCE object lock — they cannot be deleted or modified.

### Verify all logs

```bash
pip install boto3
python scripts/verify_audit_hmac.py
```

Sample output:
```
  Atom Audit HMAC Verifier
  Bucket  : audit-logs

  [  OK   ] deploy/customer-qa-agent/2026-05-16/...   ...6b3616ac032c7dfc
  [  OK   ] session/customer-qa-agent/2026-05-16/...   ...2e101a5ce0069de3
  [  OK   ] gate/2026-05-16/gate-ac7da22f97ff-pre.json  ...b4df74dded7293d2
  [NOSIG  ] 2026-05-16/time-...json                       (LiteLLM — unsigned)

  ─── Summary ───────────────────────────────────────
  Total scanned : 52
  Valid HMAC    : 14
  Invalid       : 0
  Unsigned      : 38

  All signed events verified — audit chain is intact.
```

### Verifier options

```bash
python scripts/verify_audit_hmac.py --prefix gate/          # only gate events
python scripts/verify_audit_hmac.py --date 2026-05-16       # specific date
python scripts/verify_audit_hmac.py --since gate/2026-05-16/gate-ac7d  # skip old events
python scripts/verify_audit_hmac.py --fail-fast             # stop on first failure
AUDIT_HMAC_KEY=your-key python scripts/verify_audit_hmac.py # custom key
```

### HMAC on the UI

**Audit → Events** — each row shows a shield icon:
- ✓ green shield + short hash = signed event with valid HMAC
- ? grey circle = unsigned (LiteLLM events — expected)

Hover the shield to see the full `hmac-sha256:{hex}`. Expand a row to see it in a green banner. The header shows `N/M signed` as an aggregate integrity indicator.

### What gets signed

| Source | Signed | Notes |
|--------|--------|-------|
| GATE (Go) | Yes | All pre/post events for invocations |
| builder-backend (Python) | Yes | Provision, deploy, session, tool events |
| workflow-backend (Python) | Yes | Workflow run events |
| LiteLLM | No | LiteLLM writes its own events; not signed by our code |

---

## Guardrails (AgentArmor)

Every LLM call on the platform passes through [AgentArmor](https://github.com/Agastya910/agentarmor) — an 8-layer, defence-in-depth guardrail framework integrated directly into the LiteLLM gateway as a custom guardrail pair.

### What it does

| Phase | Hook | What is scanned |
|-------|------|----------------|
| **Pre-call** | Before the request reaches Gemini | Prompt injection, goal hijacking, planning risk score |
| **Post-call** | After the model responds | PII leakage, credential exposure, data exfiltration patterns |

AgentArmor runs as its own Docker service (`agentarmor`, port 8400, built from source). LiteLLM calls it as a side-channel on every request — it never sits in the proxy path, so latency impact is bounded by a 5-second timeout.

### Fail-open design

If AgentArmor is unreachable (container restart, timeout), the request is **allowed through** and a warning is logged. This prevents a dead guardrail container from taking down the LLM gateway.

### What a violation looks like

When a scan fails, LiteLLM returns HTTP 400 to the caller with a structured body:

```json
{
  "error": "guardrail_violation",
  "guardrail": "agentarmor",
  "phase": "pre_call",
  "verdict": "deny",
  "threat_level": "high",
  "blocked_by": "planning_validator",
  "layers": [
    { "layer": "ingestion",          "verdict": "allow", "message": "" },
    { "layer": "planning_validator", "verdict": "deny",  "message": "risk score 8 — EXECUTE hard deny" }
  ],
  "message": "AgentArmor pre_call guardrail blocked this request (threat: high, blocked_by: planning_validator)"
}
```

In the Sessions tab, violations render as an inline conversation bubble (not a generic error) with the layer breakdown expandable below it.

### Per-agent opt-out

By default every agent has guardrails enabled. To disable for a specific agent, set in `agent-spec.yaml`:

```yaml
spec:
  guardrails:
    agentarmor: false
```

The builder UI's Step 4 exposes this as a toggle switch. The setting is baked into the LiteLLM virtual key metadata at deploy time — the agent cannot disable its own guardrails at request time.

### Optional ML detection sub-layers (D3/D4)

By default, L1 runs heuristic-only detection (D1/D2). Two additional ML-based
sub-detectors (D3 = HuggingFace transformers, D4 = torch) are available but
not installed by default — they add ~900 MB and can over-fire on domain-specific
language. To enable them:

```bash
docker compose build --build-arg INSTALL_ML_DEPS=true agentarmor
docker compose up -d agentarmor
```

### Tuning guardrail layers

Edit `agentarmor/config.yaml` and restart the service — no image rebuild needed:

```bash
docker compose restart agentarmor
```

Key knobs:

| Setting | Default | Effect |
|---------|---------|--------|
| `layers.ingestion.scan_prompt_injection` | `true` | Detect prompt injection in user messages |
| `layers.planning.risk_score_threshold` | `7` | Deny if action risk score ≥ N (0–10) |
| `layers.output.scan_pii` | `true` | Redact / block PII in model responses |
| `layers.output.scan_credentials` | `true` | Block responses containing secrets or tokens |
| `layers.output.scan_exfiltration` | `true` | Block exfiltration-pattern responses |

### Verifying AgentArmor is healthy

```bash
docker compose ps agentarmor           # should show "healthy"
docker compose logs agentarmor --tail 20
```

---

## Architecture Overview

```
                        +------------------+
                        |   Frontend       |  :5173
                        |  React + Vite    |
                        +--------+---------+
                                 | HTTP
                        +--------v---------+
                        |    GATE (Go)     |  :8080 (builder) :8082 (workflow)
                        |  HMAC audit wrap |
                        |  Direct invoke   |---> platform-db (pgx)
                        +-----+--------+---+
                              |        |  proxy (non-invoke routes)
               +--------------v--+  +--v--------------------+
               | builder-backend |  | workflow-backend       |
               | (FastAPI)       |  | (FastAPI + Temporal)   |
               +--+-----------+--+  +-----------------------+
                  |           |
        +---------v--+  +-----v--------+
        |  LiteLLM   |  |  platform-db |
        |  :4000     |<-+  (PostgreSQL)|
        | Gemini-only|  +--------------+
        +-----+------+
              |  pre/post-call guardrail side-channel
        +-----v----------+
        |  AgentArmor    |  :8400
        |  8-layer scan  |
        | (built source) |
        +----------------+

        Storage : MinIO (audit-logs, specs, agent-artifacts)
        Memory  : ReMe :8002 (long-term, cross-session)
        Runtime : AgentScope containers on agentnet
        Engine  : Temporal :7233
```

**Key invariants:**
1. Every LLM call goes through LiteLLM (`http://litellm:4000`)
2. Every LLM request and response is scanned by AgentArmor guardrails (pre-call + post-call)
3. Every agent has a non-human service-account identity (LiteLLM virtual key) issued at creation time
4. Agent invocation: GATE queries platform-db → calls container directly (no builder-backend on hot path)
5. All platform audit events are HMAC-SHA256 signed (sorted-key canonical JSON)
6. Audit logs stored in MinIO with 90-day COMPLIANCE object lock

---

## Service Ports

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | React UI |
| GATE (builder) | 8080 | Agent builder surface + audit proxy |
| GATE (workflow) | 8082 | Workflow surface + audit proxy |
| LiteLLM | 4000 | LLM gateway (Gemini only) |
| AgentArmor | 8400 | Pre/post-call guardrail (prompt injection, PII, exfiltration) |
| MinIO API | 9000 | Object storage |
| MinIO UI | 9001 | MinIO web console |
| Temporal UI | 8233 | Workflow engine UI |
| Grafana | 3001 | Observability dashboards |
| ReMe | 8002 | Long-term memory service |
| Studio | 3000 | AgentScope Studio |

---

## Troubleshooting

### LLM calls return 400 with `error: guardrail_violation`

AgentArmor blocked the request. The response body contains `phase`, `threat_level`, `blocked_by`, and a `layers` array showing which layer fired. Common causes:

- **`planning_validator` deny** — the action's risk score exceeded the threshold (default 7). Legitimate agent invocations should not trigger this; it fires on shell-exec-style or high-risk actions.
- **`ingestion` deny** — prompt injection detected in user input. Sanitise the input or adjust `layers.ingestion.scan_prompt_injection` in `agentarmor/config.yaml`.
- **`output` deny** — model response contained PII or credentials. Review the agent's role file to avoid generating sensitive content in outputs.

To temporarily lower strictness during development:
```bash
# Raise the planning risk threshold (0-10, higher = more permissive)
# Edit agentarmor/config.yaml → layers.planning.risk_score_threshold: 9
docker compose restart agentarmor
```

### LiteLLM starts but logs `agentarmor: pre-call scan error`

AgentArmor was not healthy when LiteLLM started. Because guardrails fail open, calls succeed — but check that AgentArmor is running:

```bash
docker compose ps agentarmor
docker compose logs agentarmor --tail 30
```

If it's crashing, check that `agentarmor/config.yaml` is valid YAML and that the `agentarmor` build completed cleanly (`docker compose build agentarmor`).

### reme is restarting

ReMe needs `FLOW_EMBEDDING_API_KEY`. Verify docker-compose.yml has:
```yaml
- FLOW_EMBEDDING_API_KEY=${LITELLM_MASTER_KEY:-sk-master-change-me}
```

### Agent container not running after platform restart

Standalone agent containers are not managed by docker-compose. After `docker compose down`, redeploy the agent from the UI (Deploy tab on agent detail) or re-run `atom agent register-local` for CLI agents pointing to a freshly started container.

### GATE returns 503 for /openapi.json

The agent container is not reachable. Redeploy from Agent Detail → Overview tab.

### LLM calls fail with 401

The agent's virtual key was issued before volumes were wiped. Re-deploy the agent from the UI to issue a fresh key against the current LiteLLM database.

### HMAC mismatch on old gate events

Events signed before the canonical-JSON fix (before sorted-key signing was deployed) will always show as `[FAIL]`. They were signed with struct-field-order JSON; this is an algorithm mismatch, not tampering. Use `--since` to skip them and verify only new events:
```bash
python scripts/verify_audit_hmac.py --since gate/2026-05-16/gate-XXXX
```

### Tool execution returns 502

- **HTTP tools**: endpoint must be reachable from within Docker (`http://service-name:port`, not `localhost`)
- **Python tools**: check syntax with `POST /tools/{id}/validate-code`; ensure `def run(input: dict) -> dict:` is defined

### Python tool runs locally but fails in platform

Tool sandbox has restricted imports. Only stdlib available: `json`, `re`, `math`, `datetime`. External packages are not available in the subprocess sandbox.

---

## Quick Reference

```bash
BASE=http://localhost:8080
H="X-Atom-Actor: user:builder@atom.io"

# Agents
curl $BASE/agents                                                    # list
curl -X POST $BASE/agents -H "$H" -d '{"name":"x","description":"y"}'  # provision
curl -X POST $BASE/agents/NAME/generate -H "$H" -d '{"behavior":"..."}'  # generate spec
curl -X POST $BASE/agents/NAME/deploy -H "$H" -d '{}'               # deploy
curl -X POST $BASE/agents/NAME/invoke -H "$H" -d '{"text":"..."}'   # invoke (stateless)
curl $BASE/agents/NAME/swagger                                        # OpenAPI spec

# Tools
curl $BASE/tools                                                     # list global tools
curl -X POST $BASE/tools -H "$H" -d '{...}'                          # create tool
curl -X POST $BASE/tools/ID/execute -H "$H" -d '{"input":{...}}'    # test tool
curl -X POST $BASE/tools/ID/validate-code -H "$H"                    # syntax check (python)

# Sessions
curl -X POST $BASE/agents/NAME/sessions -H "$H" -d '{"workspace_id":"ENTITY"}'
curl -X POST $BASE/agents/NAME/sessions/ID/messages -H "$H" -d '{"text":"..."}'
curl $BASE/agents/NAME/sessions/ID                                   # get with messages
curl -X DELETE $BASE/agents/NAME/sessions/ID -H "$H"                # end + write to ReMe

# HMAC verification
python scripts/verify_audit_hmac.py                                  # verify all
python scripts/verify_audit_hmac.py --prefix gate/ --fail-fast      # gate events only
```
