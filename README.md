# ATOM — Agentic Transformation & Operations Manager

> A secure, auditable, BFSI-grade platform for developing, governing, and deploying AI agents.

---

## What ATOM Is

ATOM is a **single-tenant, on-premises agentic platform** built for financial-services organisations.
Its core guarantee: **no agent ever touches the outside world directly** — every LLM call flows
through GATE, where it is authenticated, policy-checked, rate-limited, and appended to an
immutable hash-chained audit log.

**Sessions 00–14 are complete.** This README documents the current working state.

---

## Quick Start (docker-compose dev)

> Prerequisites: Docker Desktop, Go 1.22+, Python 3.11+, `make`, `openssl`

```bash
# 1. Clone
git clone https://github.com/your-org/atom.git && cd atom

# 2. Install toolchain (Go, Python, kind, kubectl, OPA, golang-migrate, pre-commit)
make bootstrap

# 3. Generate JWT key pair
make generate-keys          # writes .keys/jwt_private.pem + jwt_public.pem

# 4. Create environment file
cp .env.example .env
# Edit .env — set these at minimum:
#   POSTGRES_PASSWORD=changeme
#   REDIS_PASSWORD=changeme
#   PLATFORM_HMAC_SECRET=$(openssl rand -hex 32)
#   ATOM_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   LITELLM_MASTER_KEY=sk-atom-changeme
#   ATOM_LLM_KEY=sk-atom-changeme
#   GEMINI_API_KEY=...   (or OPENAI_API_KEY / ANTHROPIC_API_KEY)

# 5. Start the full stack (~20 containers)
make dev-up

# 6. Apply database migrations and load seed data
make migrate-dev
make seed-dev

# 7. Install atom CLI
make cli-install
```

Open **http://localhost:3000** → login:
- Email: `admin@atom.local`
- Password: `changeme`

---

## Architecture

```
External caller ──▶  GATE :8080  ──▶  agent container :8080
                       │  │               │
                       │  └──▶ atom-llm :4000 ──▶ LLM provider
                       │                 │
                       ▼                 ▼
                    Postgres        Kafka (Redpanda)
                    Redis           └─▶ log-archiver ──▶ MinIO
                    OPA             └─▶ Studio WebSocket (live logs)

atom-studio :3001/3000 ── manages domains, agents, HITL, deployments
atom-runtime :8090     ── deploys approved agents as Docker containers (dev)
                           or k8s pods (prod)

Grafana Alloy ─▶ Loki (all container logs) + Tempo (OTLP traces) ─▶ Grafana :3005
```

Every agent runs as an isolated container. GATE enforces JWT auth, OPA policy,
and rate limits on every request, then logs it to the immutable `audit_log_chain`.

---

## Service Map

| Service | URL | Credentials | Purpose |
|---|---|---|---|
| atom-studio UI | http://localhost:3000 | admin@atom.local / changeme | Management portal |
| atom-studio API | http://localhost:3001/docs | — | REST API + OpenAPI docs |
| GATE | http://localhost:8080 | — | Auth / policy / audit proxy |
| atom-llm | http://localhost:4000 | — | LiteLLM LLM gateway |
| atom-runtime | http://localhost:8090 | — | Agent deployment controller |
| Grafana | http://localhost:3005 | admin / admin | Logs, traces, dashboards |
| Alloy UI | http://localhost:12345 | — | Collector pipeline viz |
| Loki | http://localhost:3100 | — | Log aggregation API |
| Tempo | http://localhost:3200 | — | Distributed tracing API |
| MinIO console | http://localhost:9001 | minioadmin / changeme | Audit archive browser |
| Postgres | localhost:5432 | atom / changeme | Primary database |
| Redpanda (external) | localhost:19092 | — | Kafka-compatible broker |
| agentscope-studio | http://localhost:3002 | — | Agent run trace viewer |

---

## Repository Layout

```
atom/
├── gate/                      Go: JWT auth, OPA policy, HMAC audit chain, GATE proxy
├── atom-llm/                  LiteLLM fork: LLM gateway + Kafka audit + ATOM extensions
├── atom-sdk/                  agentscope fork: Python SDK — AtomChatModel, HITL, Toolkit
├── atom-runtime/              Agent deployment controller (Docker dev / k8s prod)
├── atom-memory/               pgvector + Redis memory backends
├── atom-studio/
│   ├── backend/               FastAPI: auth, domains, agents, HITL, deployments,
│   │                          audit log, conversations view, WebSocket log stream
│   └── frontend/              React + Vite: Studio management UI
├── atom-cli/                  Go CLI: atom login / create / deploy / logs
├── infra/
│   ├── alloy/config.alloy     Grafana Alloy River config (OTLP + Docker logs)
│   ├── grafana/               Dashboards + datasource provisioning YAML
│   ├── log-archiver/          Python: Kafka → MinIO JSONL batch archiver
│   ├── manifests/             Kubernetes manifests (all services)
│   └── tempo/tempo.yaml       Tempo storage config
├── migrations/                golang-migrate SQL files (000001 – 000011)
├── policies/                  OPA Rego policies (base + custom)
├── docs/kafka-schemas.md      Kafka topic message schemas + MinIO layout
├── decisions/                 Architecture Decision Records
├── sessions/                  SESSION-00 through SESSION-14 implementation notes
├── Makefile                   All build / dev / deploy / test targets
├── docker-compose.dev.yml     Full local stack definition
└── .env.example               Environment variable template with descriptions
```

---

## Developer Workflow

### Create and deploy an agent

```bash
# 1. Log in to Studio
atom login
# Studio URL: http://localhost:3001  |  Email: admin@atom.local  |  Password: changeme

# 2. Scaffold a new agent project
atom create
# Prompts: project name, description, LLM provider, tools, memory, HITL
# Generates: agent.py server.py tools.py config.py Dockerfile requirements.txt

# 3. Fill in the agent's .env
cd <project-name>
# Set: ATOM_AGENT_ID, ATOM_AGENT_JWT, ATOM_GATE_URL, ATOM_MODEL_NAME

# 4. Deploy (builds Docker image, submits for HITL approval)
atom deploy --agent-id <uuid>

# 5. Approve in Studio
open http://localhost:3000/hitl   # click the pending card → Approve

# 6. Call the deployed agent
curl -X POST http://localhost:8080/domain/<domain-id>/agent/<agent-id>/run \
  -H "Authorization: Bearer <agent-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Summarise RBI DPDP compliance requirements"}'

# 7. Stream live logs
atom logs <agent-id>
```

### Monitor in Studio

| Feature | Navigate to |
|---|---|
| Live log stream | Agents → Agent → **Live Logs** |
| Conversation history | Agents → Agent → **Conversations** |
| Audit chain + verify | Sidebar → **Audit Log** → Verify Chain button |
| All service logs | Grafana → Explore → Loki: `{service="gate"}` |
| Distributed traces | Grafana → Explore → Tempo → search by trace ID |
| Archived audit batches | MinIO console → atom-audit bucket |

### Useful make targets

```bash
make dev-up              # Start everything
make dev-down            # Stop (keep volumes)
make dev-down-clean      # Stop + wipe all data

make dev-rebuild         # Rebuild all images + restart (after code change)
make dev-rebuild-ui      # Rebuild frontend only
make dev-rebuild-api     # Rebuild backend only
make dev-rebuild-gate    # Rebuild GATE only

make dev-status          # Container health overview
make logs-gate           # Tail GATE
make logs-studio         # Tail atom-studio-api
make logs-alloy          # Tail Grafana Alloy

make migrate-dev         # Apply DB migrations to docker-compose postgres
make seed-dev            # Load seed data (admin user, sample domain)

make cli-install         # Build + install atom CLI
make lint                # Run all linters (Go vet + ruff + OPA check)
make test                # Run all tests
```

---

## Key Concepts

### GATE
All external and inter-service calls go through GATE on `:8080`.

- **JWT** — agents carry RS256 tokens issued by atom-studio; rotated via `regenerate-token`
- **OPA policies** — every request evaluated against `policies/base/` and `policies/custom/`
  Edit Rego files → OPA hot-reloads automatically (no restart)
- **Audit chain** — every request written to `audit_log_chain` (Postgres) with HMAC integrity
  linking, and published to `atom.audit` Kafka topic
- **Proxy routing** — `/v1/*` → atom-llm · `/hitl/*` → studio · `/memory/*` → atom-memory
  · everything else → agent pod

### Kafka Topics

| Topic | Produced by | Consumed by |
|---|---|---|
| `atom.audit` | GATE (every request) | log-archiver, Studio audit page |
| `atom.llm` | atom-llm (every LLM call) | log-archiver |
| `atom.agent.logs` | agent containers + test-log API | log-archiver, Studio Live Logs |
| `atom.deployments` | atom-studio-api (lifecycle events) | log-archiver |

Full schemas: `docs/kafka-schemas.md`

### Agent Token Types
`agent_tokens.token_type` distinguishes two token types:

| Type | Issued by | Revoked by |
|---|---|---|
| `client` | `POST /regenerate-token` | Next `regenerate-token` call |
| `pod` | `trigger_deployment` in atom-studio | Next approved deployment only |

Pod tokens are **never** revoked by client key rotation, so running containers keep working.

### HITL (Human-in-the-Loop)
Deployment approvals and custom business decisions require human sign-off. When triggered,
atom-studio pushes a WebSocket notification to all connected Studio tabs. The approving admin
clicks Approve/Reject in the HITL Queue dialog. Unanswered requests time out (configurable,
default 24 h) and fall back to the agent's configured `hitl_fallback` policy.

---

## Environment Variables

| Variable | Required | Generate with |
|---|---|---|
| `POSTGRES_PASSWORD` | ✓ | any strong password |
| `REDIS_PASSWORD` | ✓ | any strong password |
| `PLATFORM_HMAC_SECRET` | ✓ | `openssl rand -hex 32` |
| `ATOM_ENCRYPTION_KEY` | ✓ | `openssl rand -hex 32` |
| `LITELLM_MASTER_KEY` | ✓ | `sk-atom-$(openssl rand -hex 16)` |
| `ATOM_LLM_KEY` | ✓ | same as `LITELLM_MASTER_KEY` |
| `MINIO_SECRET_KEY` | ✓ | any strong password |
| `JWT_PRIVATE_KEY_PATH` | ✓ | `make generate-keys` → `.keys/jwt_private.pem` |
| `JWT_PUBLIC_KEY_PATH` | ✓ | `make generate-keys` → `.keys/jwt_public.pem` |
| `GEMINI_API_KEY` | for Gemini | from Google AI Studio |
| `OPENAI_API_KEY` | for OpenAI | from platform.openai.com |
| `ANTHROPIC_API_KEY` | for Anthropic | from console.anthropic.com |

---

## Troubleshooting

**502 Bad Gateway on Studio UI login**
```bash
docker compose -f docker-compose.dev.yml up -d --force-recreate atom-studio-ui
```

**GATE returns `token_revoked`**
```bash
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"changeme"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -X POST http://localhost:3001/api/domains/<d>/agents/<a>/regenerate-token \
  -H "Authorization: Bearer $TOKEN"
# Use the returned token for both the curl request AND the agent container env
```

**GATE returns `invalid_token`**
```bash
# Verify keys match
openssl rsa -in .keys/jwt_private.pem -pubout | diff - .keys/jwt_public.pem \
  && echo "MATCH" || echo "MISMATCH — re-run: make generate-keys"
```

**Kafka consumers not connecting**
Redpanda uses dual listeners: containers use `redpanda:9092` (INTERNAL),
host tools use `localhost:19092` (EXTERNAL).
```bash
docker exec atom-redpanda rpk topic list --brokers localhost:19092
```

**New Studio pages not visible**
The Vite bundle is compiled at Docker build time. After code changes:
```bash
make dev-rebuild-ui
```

**Conversations page crashes**
asyncpg returns JSONB as raw strings in some configurations.
```bash
make dev-rebuild-api   # picks up the _parse_jsonb_list fix
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| API Gateway | Go + Fiber v3 |
| Policy engine | OPA + Rego (hot-reload) |
| LLM gateway | LiteLLM OSS (forked → atom-llm) |
| Agent SDK | agentscope (forked → atom-sdk) + AtomChatModel |
| Agent runtime | Docker (dev) / Kubernetes (prod) via atom-runtime |
| Memory | pgvector (vector search) + Redis (session cache) |
| Studio | FastAPI + React/Vite (Tanstack Router + Query) |
| CLI | Go + Cobra |
| Primary DB | PostgreSQL 16 + pgvector extension |
| Object storage | MinIO (S3-compatible, on-prem) |
| Message broker | Redpanda (Kafka-compatible) |
| Log aggregation | Grafana Loki (via Alloy Docker log collection) |
| Distributed tracing | Grafana Tempo (via Alloy OTLP receiver) |
| Observability collector | Grafana Alloy |
| Visualisation | Grafana (Loki + Tempo datasources auto-provisioned) |
| Local k8s | kind (Kubernetes in Docker) |

---

## Completed Sessions

| # | Topic |
|---|---|
| 00 | Monorepo setup + upstream clones |
| 01 | k8s infrastructure (kind, Postgres, Redis, MinIO, Redpanda, OPA) |
| 02 | Database schema (migrations 000001–000011) |
| 03 | GATE: JWT auth, OPA integration, routing, HMAC audit chain |
| 04 | GATE: rate limiting, Kafka publish, policy enforcement |
| 05 | atom-llm: LiteLLM fork, virtual keys, Kafka audit logger |
| 06 | atom-sdk: agentscope fork, AtomChatModel, HITL hooks, Toolkit API |
| 07 | atom-studio: FastAPI backend, JWT auth, domains, agents |
| 08 | atom-studio: agent provisioning, LiteLLM virtual key management |
| 09 | atom-studio: HITL queue, deployment approval flow, WebSocket |
| 10 | atom-cli: `login` `create` `deploy` `logs` commands |
| 11 | atom-runtime: k8s controller + Docker backend for docker-compose dev |
| 12 | atom-memory: pgvector + Redis backends, MemoryManager |
| 13 | Monitoring: Grafana Alloy, Loki, Tempo, OTEL instrumentation |
| 14 | Kafka pipeline: log-archiver → MinIO, live logs, audit page, conversations view |

See `sessions/SESSION-XX.md` for detailed implementation notes and decisions.
All major decisions are in `decisions/` — start with ADR-001 for monorepo rationale.
