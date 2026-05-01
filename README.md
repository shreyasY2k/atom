# ATOM — Agentic Transformation & Operations Manager

> A secure, auditable, BFSI-grade platform for developing, governing, and deploying AI agents.

---

## What ATOM Is

ATOM is a **single-tenant, on-premises agentic platform** built for financial-services organisations.
Its core guarantee: **no agent ever touches the outside world directly** — every LLM call flows
through GATE, where it is authenticated, policy-checked, rate-limited, and appended to an
immutable hash-chained audit log.

**Sessions 00–15 are complete.** This README documents the current working state.

---

## Quick Start

### Option A — Docker Compose, operator mode (pulls from GHCR — no build needed)

```bash
git clone https://github.com/shreyasY2k/atom.git && cd atom
make generate-keys               # create .keys/ JWT key pair (once)
cp .env.example .env             # set GEMINI_API_KEY at minimum
docker compose up -d             # pulls ghcr.io/shreyasy2k/atom-*:latest
make migrate-dev && make seed-dev
open http://localhost:3000       # admin@atom.local / admin123
```

### Option B — Docker Compose, developer mode (builds from source)

```bash
git clone https://github.com/shreyasY2k/atom.git && cd atom
make generate-keys && cp .env.example .env
make dev-up                      # builds images locally (~3-5 min first run)
make migrate-dev && make seed-dev
open http://localhost:3000
```

### Option B — Kubernetes, operator path (pre-built images from GHCR, no build needed)

```bash
# Prerequisites: kubectl + helm + kind + make generate-keys + .env
make infra-up                # create kind cluster + deploy Postgres/Redis/MinIO/Redpanda/OPA
make k8s-secrets             # push credentials to cluster
make deploy-from-ghcr        # pull ghcr.io/shreyasy2k/atom-* images, apply manifests
make seed-k8s                # create admin user
make monitoring-up           # Grafana + Loki + Tempo + Alloy
sudo make ingress-hosts      # write /etc/hosts (one-time)
make ingress-up              # expose all services at *.atom.local:80
open http://studio.atom.local
```

> **atom CLI** — install without building:
> ```bash
> curl -fsSL https://github.com/shreyasY2k/atom/releases/latest/download/atom_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/') \
>   -o /usr/local/bin/atom && chmod +x /usr/local/bin/atom
> # or: go install github.com/shreyasY2k/atom/atom-cli/cmd/atom@latest
> ```

> **atom-sdk (Python)** — install direct from GitHub (no PyPI needed):
> ```bash
> pip install "git+https://github.com/shreyasY2k/atom.git#subdirectory=atom-sdk/atom_platform_sdk"
> # or from a specific release wheel:
> # pip install "atom-platform-sdk @ https://github.com/shreyasY2k/atom/releases/latest/download/atom_platform_sdk-latest-py3-none-any.whl"
> ```

### Option C — Kubernetes, developer path (build from source)

```bash
# 1. Keys + env (same as above)
make generate-keys && cp .env.example .env

# 2. Deploy infra + apps
make infra-up           # Postgres, Redis, MinIO, Redpanda, OPA, nginx-ingress
make k8s-deploy         # builds images, applies manifests, runs migrations + seed

# 3. Deploy monitoring stack (Grafana, Loki, Tempo, Alloy)
make monitoring-up

# 4. Expose via ingress
make ingress-up                 # port-forwards ingress → localhost:8088
sudo make ingress-hosts         # writes /etc/hosts entries (one-time)

# 5. Open
open http://studio.atom.local
```

---

## Architecture

```
External caller ──▶  GATE :8080  ──▶  agent pod :8080
                       │  │               │
                       │  └──▶ atom-llm :4000 ──▶ LLM provider
                       │                 │
                       ▼                 ▼
                    Postgres        Kafka (Redpanda)
                    Redis           └─▶ log-archiver ──▶ MinIO
                    OPA             └─▶ Studio WebSocket (live logs)

atom-studio :3001/3000 ── manages domains, agents, HITL, deployments
atom-runtime :8090     ── deploys approved agents as k8s pods (prod)
                           or Docker containers (dev)

Grafana Alloy ─▶ Loki (pod logs) + Tempo (OTLP traces) ─▶ Grafana
```

Every agent runs as an isolated container/pod. GATE enforces JWT auth, OPA policy,
and rate limits on every request, then logs it to the immutable `audit_log_chain`.

---

## Service Map — Docker Compose (`make dev-up`)

| Service | Local URL | Credentials | Notes |
|---------|-----------|-------------|-------|
| atom-studio UI | http://localhost:3000 | admin@atom.local / **admin123** | Management portal |
| atom-studio API | http://localhost:3001/docs | — | REST API + Swagger |
| GATE | http://localhost:8080 | — (Bearer JWT) | Agent proxy |
| atom-llm | http://localhost:4000 | Bearer **sk-atom-dev** | LiteLLM gateway |
| atom-runtime | http://localhost:8090 | — | Deploy controller |
| Grafana | http://localhost:3005 | **admin** / **atom-grafana-dev** | Dashboards |
| Alloy UI | http://localhost:12345 | — | Pipeline visualiser |
| Loki | http://localhost:3100 | — | Log aggregation API |
| Tempo | http://localhost:3200 | — | Tracing API |
| MinIO console | http://localhost:9001 | **minioadmin** / **changeme** | Audit archive UI |
| MinIO S3 API | http://localhost:9000 | **minioadmin** / **changeme** | S3-compatible |
| OPA | http://localhost:8181 | — | Policy engine |
| Postgres | localhost:5432 | **atom** / **changeme** | DB: `atom` |
| Redis | localhost:6379 | password: **changeme** | Cache / revocation |
| Kafka (Redpanda) | localhost:19092 (external) | — | Kafka-compatible |

---

## Service Map — Kubernetes (`make k8s-deploy` + `make ingress-up`)

> Requires `sudo make ingress-hosts` (one-time) and `make ingress-up` per session.
> On **kind**: services are at port **80** — no port number needed in URLs.
> On **Docker Desktop** (non-kind): services are at port **8088** via port-forward.

### /etc/hosts entry (one-time)

```
127.0.0.1  gate.atom.local api.atom.local studio.atom.local runtime.atom.local
127.0.0.1  grafana.atom.local alloy.atom.local loki.atom.local tempo.atom.local
127.0.0.1  minio.atom.local minio-ui.atom.local opa.atom.local
```

### Application services

| Service | URL (k8s) | Credentials |
|---------|-----------|-------------|
| atom-studio (UI + API) | http://studio.atom.local | admin@atom.local / **admin123** |
| atom-studio API only | http://api.atom.local/docs | — (Swagger UI) |
| GATE | http://gate.atom.local | Bearer JWT (issued by studio) |
| atom-runtime | http://runtime.atom.local/healthz | — |
| atom-llm | cluster-internal only | Bearer **sk-atom-dev** |

### Observability

| Service | URL (k8s) | Credentials |
|---------|-----------|-------------|
| Grafana | http://grafana.atom.local | **admin** / **atom-grafana-dev** |
| Alloy | http://alloy.atom.local | — |
| Loki | http://loki.atom.local | — |
| Tempo | http://tempo.atom.local | — |

### Infrastructure

| Service | URL (k8s) | Credentials |
|---------|-----------|-------------|
| MinIO S3 API | http://minio.atom.local | **minioadmin** / **changeme** |
| MinIO console | http://minio-ui.atom.local | **minioadmin** / **changeme** |
| OPA | http://opa.atom.local | — |
| Postgres | localhost:5432 (TCP via ingress) | **atom** / **changeme** — DB: `atom` |
| Redis | localhost:6379 (TCP via ingress) | password: **changeme** |
| Kafka | localhost:9092 (TCP via ingress) | — (no SASL in dev) |

> TCP services (Postgres, Redis, Kafka) are available at `localhost:<port>` when
> `make ingress-up` is running. Direct connection — no port-forward needed.

---

## Repository Layout

```
atom/
├── gate/                      Go: JWT auth, OPA policy, HMAC audit chain, proxy
├── atom-llm/                  LiteLLM fork: LLM gateway + Kafka audit + ATOM extensions
├── atom-sdk/                  agentscope fork: Python SDK — AtomChatModel, HITL, Toolkit
├── atom-runtime/              Agent deployment controller (Docker dev / k8s prod)
├── atom-memory/               pgvector + Redis memory backends
├── atom-studio/
│   ├── backend/               FastAPI: auth, domains, agents, HITL, deployments, WebSocket
│   └── frontend/              React + Vite: Studio management UI
├── atom-cli/                  Go CLI: atom login / create / deploy / logs
├── infra/
│   ├── helm/                  Helm values (Postgres, Redis, MinIO, Redpanda, Loki, Tempo, Grafana, Alloy)
│   ├── grafana/               Dashboards + datasource provisioning YAML
│   ├── log-archiver/          Python: Kafka → MinIO JSONL batch archiver
│   ├── manifests/             Kubernetes manifests (all services + ingress)
│   └── kind/                  kind cluster config
├── migrations/                golang-migrate SQL files (000001 – 000011)
├── policies/                  OPA Rego policies (base + custom)
├── tests/
│   ├── e2e/                   pytest E2E tests (conftest, test_full_flow, test_security)
│   └── load/                  k6 load test (gate_load_test.js)
├── docs/                      SECURITY.md, RUNBOOK.md, DEVELOPER_GUIDE.md
├── sessions/                  SESSION-00 through SESSION-15 implementation notes
├── Makefile                   All build / dev / deploy / test targets
├── docker-compose.dev.yml     Full local stack definition
└── .env.example               Environment variable template
```

---

## Developer Workflow

### Create and deploy an agent (k8s)

```bash
# 1. Login via CLI
bin/atom login   # interactive: prompts for studio URL, email, password

# 2. Create domain + agent in Studio UI, copy the JWT shown once after creation

# 3. Deploy (submits for HITL approval)
bin/atom deploy --agent-id <uuid> --skip-build --image <your-image>

# 4. Approve in Studio
open http://studio.atom.local/hitl

# 5. Call the deployed agent through GATE
curl -X POST http://gate.atom.local/domain/<did>/agent/<aid>/run \
  -H "Authorization: Bearer <agent-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Summarise RBI DPDP compliance requirements"}'
```

### Monitor

| What | Where |
|------|-------|
| Live log stream | Studio → Agent → Live Logs |
| Audit chain | Studio → Audit Log → Verify Chain |
| All service traces | http://grafana.atom.local → Explore → Tempo |
| Agent pod logs | http://grafana.atom.local → Explore → Loki: `{namespace="atom-agents"}` |
| MinIO audit archive | http://minio-ui.atom.local → atom-audit bucket |

### Key make targets

```bash
# ── Docker Compose ────────────────────────────────────────────────────────────
make dev-up              # Start full docker-compose stack
make dev-down            # Stop (keep volumes)
make dev-down-clean      # Stop + wipe all data
make migrate-dev         # Apply DB migrations (docker-compose)
make seed-dev            # Load seed data (docker-compose)

# ── Kubernetes ────────────────────────────────────────────────────────────────
make k8s-deploy          # Build images + deploy all services
make k8s-secrets         # Create/update atom-credentials + atom-jwt-keys Secrets
make seed-k8s            # Load seed data into k8s Postgres
make monitoring-up       # Deploy Grafana + Loki + Tempo + Alloy
make ingress-up          # Apply ingress rules + port-forward :8088
make ingress-hosts       # Append *.atom.local to /etc/hosts (run with sudo)

# ── Test ─────────────────────────────────────────────────────────────────────
make test                # Unit + integration tests (Go, Python, OPA)
make test-e2e            # E2E tests (requires k8s stack running)
make test-load           # k6 load test → tests/load/results/summary.json

# ── Build ────────────────────────────────────────────────────────────────────
make cli-build           # Build bin/atom CLI
make generate-keys       # Create JWT RSA-4096 key pair
make lint                # Go vet + ruff + OPA check
```

---

## Key Concepts

### GATE
All external and inter-service calls go through GATE on `:8080`.
- **JWT** — agents carry RS256 tokens issued by atom-studio
- **OPA** — every request evaluated against `policies/base/` (hot-reload, no restart)
- **Audit chain** — every request written to `audit_log_chain` with HMAC integrity + published to `atom.audit` Kafka topic
- **Proxy routing** — `/v1/*` → atom-llm · `/hitl/*` → studio · `/memory/*` → atom-memory · everything else → agent pod

### Kafka Topics

| Topic | Produced by | Consumed by |
|-------|-------------|-------------|
| `atom.audit` | GATE (every request) | log-archiver, Studio audit page |
| `atom.llm` | atom-llm (every LLM call) | log-archiver |
| `atom.agent.logs` | agent containers | log-archiver, Studio Live Logs |
| `atom.deployments` | atom-studio-api | log-archiver |

### Agent Token Types

| Type | Issued by | Revoked by |
|------|-----------|-----------|
| `client` | `POST /regenerate-token` | Next `regenerate-token` call |
| `pod` | `trigger_deployment` | Next approved deployment only |

Pod tokens are **never** revoked by client key rotation — running containers keep working.

---

## Environment Variables

| Variable | Default | Generate with |
|----------|---------|---------------|
| `POSTGRES_PASSWORD` | `changeme` | any strong password |
| `REDIS_PASSWORD` | `changeme` | any strong password |
| `PLATFORM_HMAC_SECRET` | (pre-set) | `openssl rand -hex 32` |
| `ATOM_ENCRYPTION_KEY` | (pre-set) | `openssl rand -hex 32` |
| `LITELLM_MASTER_KEY` | `sk-atom-dev` | `sk-atom-$(openssl rand -hex 16)` |
| `ATOM_LLM_KEY` | `sk-atom-dev` | same as `LITELLM_MASTER_KEY` |
| `MINIO_SECRET_KEY` | `changeme` | any strong password |
| `JWT_PRIVATE_KEY_PATH` | `./.keys/jwt_private.pem` | `make generate-keys` |
| `GEMINI_API_KEY` | — | https://aistudio.google.com/app/apikey |

---

## Troubleshooting

**Cannot log in to Studio (401)**
```bash
# k8s: re-run seed
make seed-k8s
# docker-compose:
make seed-dev
# Credentials: admin@atom.local / admin123
```

**Studio UI loads but API calls fail (502 / 404)**
```bash
# k8s: ensure ingress routes /api on studio.atom.local
kubectl get ingress -n atom-system
# Should show studio.atom.local with paths /api, /ws, /
```

**GATE returns `token_revoked`**
```bash
TOKEN=$(curl -s -X POST http://api.atom.local/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -X POST http://api.atom.local/api/domains/<did>/agents/<aid>/regenerate-token \
  -H "Authorization: Bearer $TOKEN"
```

**atom-llm pod keeps crashing (P1001 Postgres error)**
```bash
# LiteLLM Prisma schema not applied yet
kubectl port-forward -n atom-infra svc/postgres-postgresql 5433:5432 &
SCHEMA=$(docker run --rm atom-llm:local python3 -c \
  "import litellm,os; print(os.path.join(os.path.dirname(litellm.__file__),'proxy','schema.prisma'))")
docker run --rm -e DATABASE_URL="postgresql://atom:changeme@host.docker.internal:5433/atom" \
  --add-host host.docker.internal:host-gateway \
  atom-llm:local prisma db push --schema $SCHEMA --skip-generate --accept-data-loss
```

**Alloy OTEL export errors in logs**
```bash
# Ensure Alloy + monitoring stack is deployed
make monitoring-up
# Alloy service must exist in atom-system for OTLP to resolve
kubectl get svc alloy -n atom-system
```

**ingress-hosts needs sudo**
```bash
sudo bash -c 'echo "127.0.0.1  gate.atom.local api.atom.local studio.atom.local runtime.atom.local grafana.atom.local alloy.atom.local loki.atom.local tempo.atom.local minio.atom.local minio-ui.atom.local opa.atom.local" >> /etc/hosts'
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
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
| Log collection | Grafana Alloy (loki.source.kubernetes) |
| Log storage | Grafana Loki |
| Distributed tracing | Grafana Tempo |
| Observability collector | Grafana Alloy (OTLP receiver) |
| Visualisation | Grafana |
| Kubernetes | Docker Desktop (3-node kind-backed cluster) |

---

## Completed Sessions

| # | Topic |
|---|-------|
| 00 | Monorepo setup + upstream clones |
| 01 | k8s infrastructure (Postgres, Redis, MinIO, Redpanda, OPA, nginx-ingress) |
| 02 | Database schema (migrations 000001–000011) |
| 03 | GATE: JWT auth, OPA integration, routing, HMAC audit chain |
| 04 | GATE: rate limiting, Kafka publish, policy enforcement |
| 05 | atom-llm: LiteLLM fork, virtual keys, Kafka audit logger |
| 06 | atom-sdk: agentscope fork, AtomChatModel, HITL hooks, Toolkit API |
| 07 | atom-studio: FastAPI backend, JWT auth, domains, agents |
| 08 | atom-studio: agent provisioning, LiteLLM virtual key management |
| 09 | atom-studio: HITL queue, deployment approval flow, WebSocket |
| 10 | atom-cli: `login` `create` `deploy` `logs` commands |
| 11 | atom-runtime: k8s controller + Docker backend |
| 12 | atom-memory: pgvector + Redis backends, MemoryManager |
| 13 | Monitoring: Grafana Alloy, Loki, Tempo, OTEL instrumentation |
| 14 | Kafka pipeline: log-archiver → MinIO, live logs, audit page |
| 15 | k8s deploy + E2E tests + security hardening + ingress |

See `sessions/SESSION-XX.md` for detailed implementation notes.
