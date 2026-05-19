# Atom Agent Platform

> Build auditable, deployable agents from versioned specs — and compose them into existing business workflows without rebuilding processes from scratch.

---

## Table of Contents

1. [What is Atom?](#what-is-atom)
2. [Prerequisites](#prerequisites)
3. [Starting from Scratch](#starting-from-scratch)
4. [Creating an Agent (UI)](#creating-an-agent-ui)
5. [Editing a Deployed Agent](#editing-a-deployed-agent)
6. [Creating an Agent (CLI)](#creating-an-agent-cli)
7. [Domain / Subdomain Framework](#domain--subdomain-framework)
8. [Creating and Testing Tools](#creating-and-testing-tools)
9. [Domain Tool Registry](#domain-tool-registry)
10. [Sessions and Memory](#sessions-and-memory)
11. [Invoking Agents via API](#invoking-agents-via-api)
12. [Compliance Reports](#compliance-reports)
13. [HMAC Audit Log Verification](#hmac-audit-log-verification)
14. [Security Command Center](#security-command-center)
15. [Guardrails (10-Layer Defence-in-Depth)](#guardrails-10-layer-defence-in-depth)
16. [Architecture Overview](#architecture-overview)
17. [Service Ports](#service-ports)
18. [Troubleshooting](#troubleshooting)

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
curl http://localhost:8080/gate/health  # GATE (port 8080, builder surface)
curl http://localhost:8082/gate/health  # GATE (port 8082, workflow surface)
curl http://localhost:8083/gate/health  # GATE (port 8083, LLM proxy — all agent LLM calls)
```

---

## Creating an Agent (UI)

Navigate to **http://localhost:5173** → login as `builder` → **Agents → Build Agent**

The wizard has 4 steps:

### Step 1 — Basic Info

Fill in:
- **Agent Name**: `customer-qa-agent` *(lowercase, hyphens only, 3-40 chars)*
- **Description**: `Answers customer questions about KYC status and transaction risk`
- **Domain**: `general` *(autocomplete from known taxonomy — see [Domain / Subdomain Framework](#domain--subdomain-framework))*
- **Subdomain**: `qa` *(optional — narrows the domain further)*

Click **Continue** — this immediately provisions a LiteLLM virtual key and creates a DB record. The agent has an identity before deployment. Domain and subdomain are stored in the `agents` table and control filter visibility in the Agent Registry.

> **Back navigation**: every step has a Back button. Clicking a completed step in the left sidebar also jumps directly to it.

### Step 2 — Tools & Custom Context

**Associate global tools** (select from the Tool Registry — domain-grouped):
- `get_customer_profile` — fetches KYC profile from kyc-svc
- `calculate_risk` — pure-Python risk score (no service call)

Tool names shown here are the **exact function names** used in generated agent code. See [Domain Tool Registry](#domain-tool-registry) for the full catalogue.

**Custom Context** (optional): domain knowledge injected into the generation prompt.
- Name: `compliance-rules`
- Content: domain-specific rules, output format requirements, or terminology

> **Custom Context ≠ skills**: it is baked into the generated role file at generation time, not stored separately after deployment.

### Step 3 — Generate

Describe the agent's behavior in natural language:

```
When a customer asks about their account status:
1. Extract the customer_id, transaction amount, and country code from the input.
2. Call get_customer_profile with the customer_id to verify KYC status.
3. Call calculate_risk with the amount and country code to get the risk band.
4. Return a JSON summary: customer_name, kyc_status, risk_band, verdict
   (APPROVE / REVIEW / ESCALATE), and a case note explaining your reasoning.
```

Click **Generate** — Gemini 3.1 Pro generates the agent-role markdown and spec YAML, saved to MinIO as a draft. The editor is editable — change anything before proceeding.

Click **Regenerate** to produce a new version at any time. Your edits are preserved until you explicitly click Regenerate.

### Step 4 — Deploy

Review the generated spec and role markdown in the Monaco editors (both are editable — look for the ✎ **Editable** badge in the file header).

**AgentArmor Guardrails toggle** (default: ON): activates all 10 security layers for this agent. Keep ON in production.

Click:
- **Deploy directly** — deploys immediately (admin/approver role)
- **Submit for approval** — creates a pending record for an approver

The agent container is built and started on the Docker network. Status transitions: `provisioned → draft → deploying → deployed`.

---

## Editing a Deployed Agent

To modify a deployed agent's spec, role, or tools:

1. Go to **Agents → Registry**, click the agent name, open the **Overview** tab
2. Click **Edit Agent** — this copies the latest versioned spec/role to a draft and navigates to the Builder wizard
3. The Builder opens at the **Generate** step (or **Deploy** if a draft exists) with all existing data pre-filled
4. Edit as needed: update tools in step 2, regenerate in step 3, or go straight to deploy in step 4
5. Deploy — a new version is created; the previous version remains immutable in MinIO

> Editing does **not** interrupt the currently running container. The new version replaces it only after deploy.

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

## Domain / Subdomain Framework

Every agent and tool belongs to a **domain** and optionally a **subdomain**. These tags control how things are grouped and filtered throughout the platform.

### Taxonomy

| Domain | Subdomains | Description |
|--------|-----------|-------------|
| `banking` | `kyc`, `fraud`, `treasury`, `securities` | Core banking operations |
| `payments` | `risk`, `compliance` | Payment processing and OFAC screening |
| `insurance` | `claims`, `ocr` | Claims processing and document extraction |
| `general` | `qa`, `risk` | Cross-domain and general-purpose agents |

The taxonomy is open — add any domain/subdomain value you need. Known values are surfaced as autocomplete options.

### Where domain/subdomain are used

**Agents** — domain is extracted from `metadata.domain` in the spec YAML at deploy time. `banking-kyc` → `domain=banking, subdomain=kyc`. The Builder step 1 has autocomplete fields.

**Tools** — seeded tools are tagged with domain/subdomain in `seed.py` via the `_TOOL_DOMAIN` map. Custom tools can be tagged when creating them.

### Filtering in the UI

**Agent Registry** (`/agents`):
- Click a domain chip to show only agents in that domain
- Click a status chip (Deployed / Deploying / Undeployed) to filter by status
- Use the search box for name/description search
- Multiple filters combine (AND)

**Tool Registry** (`/tools`):
- Tools are grouped into collapsible accordions by domain
- Domain filter chips at the top collapse the view to one domain
- Search narrows within any selected domain

### Filtering via API

```bash
# Agents
curl "http://localhost:8080/agents?domain=banking"
curl "http://localhost:8080/agents?domain=banking&subdomain=kyc"
curl "http://localhost:8080/agents?status=deployed"
curl "http://localhost:8080/agents?domain=banking&status=deployed"

# Tools
curl "http://localhost:8080/tools?domain=banking"
curl "http://localhost:8080/tools?domain=banking&subdomain=kyc"

# Domain taxonomy (what's known in the DB)
curl "http://localhost:8080/domains"
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

## Domain Tool Registry

The platform ships with a pre-built domain tool library in `builder-backend/app/tools/registry.py`. These are Python callables that wrap the mock services. At code-gen time the spec's `domain` field and `tools` list are resolved against this registry, and the matching functions are embedded directly into the deployed agent container.

These are distinct from tools you create via the Tool Registry UI (those are stored in the DB as HTTP/Python/MCP records). Domain tools live in code; they require no manual creation before building an agent.

### Tools by domain

#### `banking-kyc`

| Tool | Description | Mock service |
|------|-------------|-------------|
| `get_customer_profile(customer_id)` | KYC profile + staleness flag (`is_stale` = age > 730d) | kyc-svc :8095 |
| `get_kyc_documents(customer_id)` | Passports, licenses on file | kyc-svc :8095 |
| `get_external_screening(customer_id, name, address)` | Adverse media + PEP screening | kyc-svc :8095 |

```bash
curl http://localhost:8095/profile/CUST-100442
curl http://localhost:8095/documents/CUST-100442
curl -X POST http://localhost:8095/screening \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"CUST-100442","name":"Margaret Wong","address":""}'
```

#### `banking-securities-ops`

| Tool | Description | Mock service |
|------|-------------|-------------|
| `get_customer_positions(transfer_id)` | Transfer details + current holdings for reconciliation | securities-ops :8099 |
| `get_security_master(cusip)` | Reference data for a security | securities-ops :8099 |
| `check_position_lots(customer_id, cusip)` | Lot-level position breakdown | securities-ops :8099 |

```bash
curl http://localhost:8099/positions/XFER-100442-001
curl http://localhost:8099/security-master/912828ZQ6
curl -X POST http://localhost:8099/position-lots \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"CUST-100442","cusip":"912828ZQ6"}'
```

#### `banking-treasury`

| Tool | Description | Mock service |
|------|-------------|-------------|
| `get_overnight_positions()` | Overnight liquidity from treasury data warehouse | treasury-dw :8090 |
| `get_market_data()` | Current rates + FX data | market-data :8091 |
| `compute_lcr(hqla_total, outflows_30d)` | Liquidity Coverage Ratio calculation | lcr-engine :8092 |
| `get_trailing_metrics()` | 30/90-day trailing LCR metrics (synthetic) | — (inline) |
| `validate_hqla_composition(positions)` | HQLA L1/L2 regulatory cap check | — (inline) |

```bash
curl http://localhost:8090/positions
curl http://localhost:8091/rates
curl http://localhost:8091/fx
curl -X POST http://localhost:8092/calculate \
  -H "Content-Type: application/json" \
  -d '{"hqla_total":500000000,"outflows_30d":350000000}'
```

#### `banking-fraud`

| Tool | Description | Mock service |
|------|-------------|-------------|
| `get_transaction_history(customer_id, limit)` | Recent transactions including flagged items | fraud-svc :8102 |
| `get_customer_baseline(customer_id)` | Spending baseline + risk tier | fraud-svc :8102 |
| `get_peer_segment_stats(customer_id)` | Peer segment comparison stats | fraud-svc :8102 |

```bash
curl "http://localhost:8102/transactions?customer_id=CUST-100442&limit=5"
curl "http://localhost:8102/customer-baseline?customer_id=CUST-100442"
curl "http://localhost:8102/peer-segment?customer_id=CUST-100442"
```

#### `payments`

Combines KYC, fraud, and OFAC tools. Includes common Gemini-generated name aliases (`get_risk_baseline`, `check_kyc_profile`, `ofac_screen`, etc.) so agent code-gen is tolerant of minor naming variation.

| Tool | Description | Mock service |
|------|-------------|-------------|
| `get_fraud_signals(customer_id)` | Combined: history + baseline + peer segment in one call | fraud-svc :8102 |
| `get_kyc_profile(customer_id)` | KYC profile status | kyc-svc :8095 |
| `screen_ofac_sanctions(customer_id, amount_usd)` | OFAC sanctions list screening | ofac-svc :8096 |
| `get_transaction_history(customer_id)` | Transaction history | fraud-svc :8102 |
| `get_customer_baseline(customer_id)` | Spending baseline | fraud-svc :8102 |
| `get_peer_segment_stats(customer_id)` | Peer segment stats | fraud-svc :8102 |
| `get_customer_profile(customer_id)` | Full KYC profile | kyc-svc :8095 |
| `get_external_screening(customer_id)` | Adverse media screening | kyc-svc :8095 |

```bash
curl -X POST http://localhost:8096/screen \
  -H "Content-Type: application/json" \
  -d '{"customer_id":"CUST-100442","amount_usd":40000}'
```

#### `insurance-claims`

| Tool | Description | Mock service |
|------|-------------|-------------|
| `extract_document_text(sample_id)` | OCR text from pre-staged claim document | ocr-svc :8094 |
| `parse_repair_estimate(text)` | Parse repair invoice text → structured line items | — (inline) |
| `lookup_policy(policy_number)` | Policy detail by number | fnol-svc :8093 |
| `get_claims_history(policy_number, lookback_days)` | Prior claims (default 730d) | fnol-svc :8093 |
| `verify_arithmetic(line_items, claimed_total)` | Invoice line-item sum vs claimed total | fnol-svc :8093 |
| `check_coverage(policy_number, claim_type, claim_amount)` | Is this claim covered under the policy? | fnol-svc :8093 |
| `get_red_flag_signals(policy_number, claim_amount, loss_date)` | Fraud pattern signals | fnol-svc :8093 |

```bash
curl "http://localhost:8094/ocr/extract-by-sample-id?sample_id=auto-repair-invoice"
curl http://localhost:8093/policies/POL-882-447-AC
curl http://localhost:8093/claims-history/POL-882-447-AC
curl -X POST http://localhost:8093/coverage-check \
  -H "Content-Type: application/json" \
  -d '{"policy_number":"POL-882-447-AC","claim_type":"windshield_repair","claim_amount":485.00}'
curl -X POST http://localhost:8093/red-flag-signals \
  -H "Content-Type: application/json" \
  -d '{"policy_number":"POL-882-447-AC","claim_amount":485.00,"loss_date":"2026-04-10"}'
```

### Test data reference

#### Customers (KYC / fraud / payments)

| Customer ID | Name | Risk | KYC Status | Notes |
|-------------|------|------|------------|-------|
| CUST-100442 | Margaret Wong | LOW | Fresh (2026-01-01) | Routine path — clean profile |
| CUST-200119 | David Eisenberg | MEDIUM | Fresh (2025-08-04) | High-value path — clean profile |
| CUST-300577 | Aaron Patel | MEDIUM | **Stale** (2023-01-10, >730d) | Low-confidence KYC path |

#### Securities transfers (banking-securities-ops)

| Transfer ID | Customer | Amount | Security (CUSIP) | Scenario |
|-------------|----------|--------|------------------|----------|
| XFER-100442-001 | CUST-100442 | ~$40K | UST 2Y (912828ZQ6) | Routine recon |
| XFER-200119-001 | CUST-200119 | ~$1.2M | UST 10Y (912810RW0) | High-value recon |
| XFER-300577-001 | CUST-300577 | ~$50K | UST 2Y (912828ZQ6) | Stale KYC recon |

#### Insurance policies (insurance-claims)

| Policy Number | Policyholder | Scenario |
|---------------|-------------|---------|
| POL-882-447-AC | Robert Chen | Windshield repair invoice |
| POL-771-993-CL | Sandra Martinez | Collision damage claim |
| POL-339-228-MD | James Okafor | Medical bill claim |

#### OCR documents (insurance-claims)

| Sample ID | Description |
|-----------|-------------|
| `auto-repair-invoice` | Pre-staged windshield repair invoice for POL-882-447-AC demo |

### ATS workflow mock services

| Service | Port | Used for |
|---------|------|---------|
| swift-gw | 8097 | Accepts MT103 transfer instructions (`POST /instructions`) |
| task-queue | 8098 | Human-task notification queue |
| incoming-queue | 8101 | Incoming transfer notification queue |

```bash
# Simulate submitting a transfer instruction through the SWIFT/DTC gateway
curl -X POST http://localhost:8097/instructions \
  -H "Content-Type: application/json" \
  -d '{"transfer_id":"XFER-100442-001","instructions_ref":"MT103-XFER-100442-001"}'
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

## Compliance Reports

Each deployed agent has a **Compliance Report** tab in the Agent Detail page that generates a formal compliance assessment from the agent's audit trail.

### Generate from the UI

1. Open an agent detail page → **Compliance** tab
2. Select the period (7 / 30 / 90 days)
3. Click **Generate Report** — runs in the background (15–30s)
4. The report renders inline as formatted Markdown
5. Download as `.md` via the download button

### Report sections

| # | Section | Data source |
|---|---------|-------------|
| 1 | Executive Summary | LLM synthesis |
| 2 | Agent Identity & Deployment | `agents` table |
| 3 | Activity Summary | `llm_call_events` |
| 4 | Security Posture | `guardrail_events` |
| 5 | Data Handling Assessment | L2-PII events |
| 6 | Audit Trail Integrity | MinIO HMAC events |
| 7 | Risk Assessment | LLM synthesis |
| 8 | Recommendations | LLM synthesis |
| 9 | Compliance Declaration | LLM synthesis |

### Generate via API

```bash
BASE=http://localhost:8080
H="X-Atom-Actor: user:admin@atom.io"

# Kick off generation (returns report_id immediately)
curl -X POST $BASE/agents/customer-qa-agent/compliance-report \
  -H "$H" -H "Content-Type: application/json" \
  -d '{"period_days": 30}'

# Poll status (generating → complete or failed)
curl $BASE/agents/customer-qa-agent/compliance-report/report-XXXX -H "$H"

# List all reports for an agent
curl $BASE/agents/customer-qa-agent/compliance-reports -H "$H"
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

## Security Command Center

Navigate to **http://localhost:5173/command-center** to see the real-time security dashboard.

It shows:
- **Overview cards**: total LLM calls, active agents, guardrail blocks, PII redactions, latency (avg + p95)
- **10-layer security posture grid**: live status (active/idle), event counts, fail mode, and phase for each layer
- **Per-agent stats table**: call counts, latency, errors, blocks, PII redactions, guard rate bar
- **Recent events feed**: live guardrail decisions (block/redact/allow) with threat type and agent attribution

Data refreshes every 30 seconds from `platform-db` (`llm_call_events` + `guardrail_events` tables).

---

## Guardrails (10-Layer Defence-in-Depth)

Every LLM call on the platform is protected by a 10-layer security posture. Layers 1–2 run inline in the LiteLLM proxy; layers 3–6 and 9–10 call [AgentArmor](https://github.com/Agastya910/agentarmor); layer 7 is the GATE LLM proxy; layer 8 is the tool permission guardrail.

### LLM Call Path

```
Agent container
  └─ LITELLM_BASE_URL=http://gate:8083
        ↓
  GATE:8083 (llm_proxy.go)       ← L7: mandatory audit, llm_call_events DB write
        ↓
  LiteLLM:4000
    ├─ L1 Local Heuristic Scan   ← fail-CLOSED regex (injection/jailbreak/destructive)
    ├─ L2 PII Redaction          ← masks email/SSN/CC/phone before LLM
    ├─ L3-L6 AgentArmor pre      ← semantic injection, goal-lock, planning risk, rate limit
    ├─ → Gemini API
    ├─ L8 Tool permission        ← allowlist/denylist per agent domain
    └─ L9-L10 AgentArmor post    ← output PII, credential, exfiltration scan
```

### Security Layer Reference

| # | Layer | Phase | Fail Mode | What it catches |
|---|-------|-------|-----------|----------------|
| L1 | Local Heuristic Scan | pre-call | **CLOSED** | Prompt injection, jailbreaks, `rm -rf`, privilege escalation |
| L2 | PII Detection + Redaction | pre-call | OPEN | Email, SSN, credit card, phone, DOB, IP → `[PII:TYPE]` |
| L3 | AgentArmor Input Ingestion | pre-call | OPEN | Semantic injection detection |
| L4 | Goal-Lock | pre-call | OPEN | Context hijacking — agent off its assigned goal |
| L5 | Planning Risk Score | pre-call | OPEN | Action risk ≥ 7 → block |
| L6 | Rate Limiting | pre-call | OPEN | Per-agent call rate enforcement |
| L7 | GATE LLM Proxy | proxy | N/A | Mandatory audit — agents cannot bypass |
| L8 | Tool Permission | post-call | **CLOSED** | Tool allowlist/denylist per agent domain |
| L9 | Output PII + Credential | post-call | OPEN | PII leakage, credential exposure in LLM output |
| L10 | Exfiltration Detection | post-call | OPEN | Data exfiltration patterns in output |

AgentArmor runs as its own Docker service (`agentarmor`, port 8400, built from source). LiteLLM calls it as a side-channel — it never sits in the proxy path, so latency impact is bounded by a 5-second timeout.

### L1 is fail-closed

L1 runs inline with no network call. A regex match blocks immediately regardless of AgentArmor state. This is the only truly fail-closed layer for injection/jailbreak/destructive command patterns.

### Fail-open design (L3-L6, L9-L10)

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
                      +----------v-----------+
                      |       GATE (Go)       |
                      | :8080 builder surface |
                      | :8082 workflow surface|
                      | :8083 LLM proxy  ←────────── every agent LLM call
                      | HMAC audit wrap       |       (mandatory chokepoint)
                      | Direct invoke    ─────────→  platform-db (pgx)
                      +----+----------+-------+
                           |          | proxy
          +----------------v-+   +----v-------------------+
          | builder-backend  |   | workflow-backend        |
          | (FastAPI)        |   | (FastAPI + Temporal)    |
          | /domains         |   +------------------------+
          | /compliance      |
          | /command-center  |
          +----+----------+--+
               |          |
     +---------v--+  +-----v--------+
     |  LiteLLM   |  |  platform-db |
     |  :4000     |<-+  (PostgreSQL)|
     | Gemini-only|  | agents       |
     +-----+------+  | llm_call_evt |
           |         | guardrail_evt|
     (pre/post-call) | compliance   |
     +-----v-------+ +--------------+
     |  AgentArmor |
     |  :8400      |   Storage : MinIO (audit-logs, specs, agent-artifacts)
     | L1-closed   |   Memory  : ReMe :8002 (long-term, cross-session)
     | L2 PII mask |   Runtime : AgentScope containers on agentnet
     | L3-L6 scans |   Engine  : Temporal :7233
     | L9-L10 out  |
     +-------------+
```

**Key invariants:**
1. **Every LLM call goes through GATE:8083** (mandatory audit chokepoint) before reaching LiteLLM
2. Every LLM call goes through LiteLLM (`http://litellm:4000`) — Gemini only
3. Every LLM request is scanned by 10-layer guardrails (L1 fail-closed, L2-L10 fail-open)
4. Every agent has a non-human service-account identity (LiteLLM virtual key) issued at creation time
5. Agent invocation: GATE:8080 queries platform-db → calls container directly (no builder-backend on hot path)
6. All platform audit events are HMAC-SHA256 signed (sorted-key canonical JSON)
7. Audit logs stored in MinIO with 90-day COMPLIANCE object lock

---

## Service Ports

**Platform services**

| Service | Port | Purpose |
|---------|------|---------|
| Frontend | 5173 | React UI — Agent Builder, Workflow Composer, Command Center |
| GATE (builder) | 8080 | Agent builder surface + HMAC audit proxy |
| GATE (workflow) | 8082 | Workflow surface + HMAC audit proxy |
| **GATE (LLM proxy)** | **8083** | **Mandatory LLM call chokepoint — all agents use this** |
| LiteLLM | 4000 | LLM gateway (Gemini only). Health: `GET /health/liveliness` |
| AgentArmor | 8400 | 10-layer guardrail (prompt injection, PII, planning risk, exfiltration) |
| MinIO API | 9000 | Object storage |
| MinIO UI | 9002 | MinIO web console |
| Temporal UI | 8233 | Workflow engine UI |
| Grafana | 3001 | Observability dashboards |
| ReMe | 8002 | Long-term memory service (embeddings via LiteLLM) |
| Studio | 3000 | AgentScope Studio |

**Mock services** (synthetic data — see [Domain Tool Registry](#domain-tool-registry) for test IDs)

| Service | Port | Domain | Endpoints |
|---------|------|--------|-----------|
| kyc-svc | 8095 | banking-kyc, payments | `GET /profile/{id}`, `/documents/{id}`, `POST /screening` |
| ofac-svc | 8096 | payments | `POST /screen` |
| swift-gw | 8097 | ATS workflow | `POST /instructions` |
| task-queue | 8098 | ATS workflow | Human-task notification queue |
| securities-ops | 8099 | banking-securities-ops | `GET /positions/{id}`, `/security-master/{cusip}`, `POST /position-lots` |
| incoming-queue | 8101 | ATS workflow | Incoming transfer notification queue |
| fraud-svc | 8102 | banking-fraud, payments | `GET /transactions`, `/customer-baseline`, `/peer-segment` |
| treasury-dw | 8090 | banking-treasury | `GET /positions` |
| market-data | 8091 | banking-treasury | `GET /rates`, `/fx` |
| lcr-engine | 8092 | banking-treasury | `POST /calculate` |
| fnol-svc | 8093 | insurance-claims | `GET /policies/{num}`, `/claims-history/{num}`, `POST /coverage-check`, `/red-flag-signals`, `/verify-arithmetic` |
| ocr-svc | 8094 | insurance-claims | `GET /ocr/extract-by-sample-id?sample_id=...` |

---

## Troubleshooting

### LLM calls return 400 with `error: guardrail_violation`

A guardrail blocked the request. The response body contains `phase`, `threat_level`, `blocked_by`, and `layers`.

| `blocked_by` | Cause | Fix |
|---|---|---|
| `L1-LocalHeuristic` | Prompt injection / jailbreak / destructive command in user input | Expected — it's a deliberate attack. If it's a false positive, check if the user message contains injection-like wording |
| `L2-PII` | — | L2 never blocks; it redacts and continues |
| `agentarmor-ingestion` | Semantic injection detected by AgentArmor API | Check `agentarmor/config.yaml`, lower `risk_level` from `medium` to `low` |
| `planning_validator` | Agent's planned action risk score ≥ 7 | Adjust role file to avoid high-risk action plans |

**L1 false positive in sessions** — if a session has a prior injection message in its history, subsequent valid messages in the same session may be blocked because the history includes the injection text. Fix: start a new session. The platform now strips injection-blocked messages from conversation history automatically.

### Valid request blocked after sending an injection in the same session

The session history included prior attack text. From session 09+, injection-blocked turns are stripped from the `[Conversation so far]` block before it's sent to the agent. If you see this on an older deployment:
- Start a new chat session
- Or clear the session with `DELETE /agents/{name}/sessions/{session_id}`

### LiteLLM `/health` returns 401

Expected — `/health` requires the master key. Use `/health/liveliness` for unauthenticated liveness checks:
```bash
curl http://localhost:4000/health/liveliness   # returns "I'm alive!"
```
The 401 errors you see in logs are from the LiteLLM admin UI tab polling `/health` from the browser without auth. They do not affect platform operation.

### ReMe embedding calls fail with "no api key"

ReMe uses `OPENAI_API_KEY=${LITELLM_MASTER_KEY}` to call LiteLLM for embeddings. If you see this, check:
```bash
docker compose exec reme env | grep OPENAI_API_KEY
# Should show the master key. If empty, rebuild: docker compose up -d reme
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

# Health checks
curl http://localhost:8080/gate/health          # GATE builder
curl http://localhost:8082/gate/health          # GATE workflow
curl http://localhost:8083/gate/health          # GATE LLM proxy (MANDATORY for all agent LLM calls)
curl http://localhost:4000/health/liveliness    # LiteLLM (no auth required)

# Agents — list, provision, generate, deploy, invoke
curl "$BASE/agents"                                                    # list all
curl "$BASE/agents?domain=banking"                                     # filter by domain
curl "$BASE/agents?domain=banking&subdomain=kyc"                       # filter by subdomain
curl "$BASE/agents?status=deployed"                                    # filter by status
curl -X POST $BASE/agents -H "$H" -d '{"name":"x","description":"y"}' # provision
curl -X POST $BASE/agents/NAME/generate -H "$H" -d '{"behavior":"..."}' # generate spec
curl -X POST $BASE/agents/NAME/deploy-direct -H "$H" -d '{}'          # deploy (bypass approval)
curl -X POST $BASE/agents/NAME/deploy-request -H "$H" -d '{}'         # submit for approval
curl -X POST $BASE/agents/NAME/edit -H "$H"                            # copy versioned→draft for editing
curl $BASE/agents/NAME/draft -H "$H"                                   # get current draft spec+role
curl -X POST $BASE/agents/NAME/invoke -H "$H" -d '{"text":"..."}'     # invoke (stateless)
curl $BASE/agents/NAME/swagger                                         # OpenAPI spec

# Domain taxonomy
curl $BASE/domains                                                     # all known domains+subdomains

# Tools — list, filter, create, test
curl "$BASE/tools"                                                     # list all global tools
curl "$BASE/tools?domain=banking"                                      # filter by domain
curl "$BASE/tools?domain=banking&subdomain=kyc"                        # filter by subdomain
curl -X POST $BASE/tools -H "$H" -d '{...}'                            # create tool
curl -X POST $BASE/tools/ID/execute -H "$H" -d '{"input":{...}}'      # test tool
curl -X POST $BASE/tools/ID/validate-code -H "$H"                     # syntax check (python)

# Sessions
curl -X POST $BASE/agents/NAME/sessions -H "$H" -d '{"workspace_id":"ENTITY"}'
curl -X POST $BASE/agents/NAME/sessions/ID/messages -H "$H" -d '{"text":"..."}'
curl $BASE/agents/NAME/sessions/ID                                     # get with messages
curl -X DELETE $BASE/agents/NAME/sessions/ID -H "$H"                  # end + write to ReMe

# Compliance reports
curl -X POST $BASE/agents/NAME/compliance-report -H "$H" -d '{"period_days":30}'  # generate
curl $BASE/agents/NAME/compliance-report/REPORT_ID -H "$H"            # poll status + get markdown
curl $BASE/agents/NAME/compliance-reports -H "$H"                     # list all reports

# Security Command Center
curl $BASE/command-center/overview                                     # platform-wide stats
curl $BASE/command-center/layers                                       # 10-layer security status
curl $BASE/command-center/agents                                       # per-agent stats
curl $BASE/command-center/timeseries                                   # hourly time-series data
curl $BASE/command-center/events                                       # recent guardrail events

# HMAC verification
python scripts/verify_audit_hmac.py                                    # verify all
python scripts/verify_audit_hmac.py --prefix gate/ --fail-fast        # gate events only
```
