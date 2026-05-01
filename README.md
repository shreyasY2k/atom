# ATOM — Agentic Transformation & Operations Manager

> A secure, auditable, BFSI-grade platform for developing, governing, and deploying AI agents.
> Every LLM call flows through GATE: authenticated, policy-checked, rate-limited, and audit-logged.

---

## Prerequisites

### Always required

| Tool | Version | Install |
|------|---------|---------|
| Docker Desktop | 24+ | [docker.com](https://www.docker.com/products/docker-desktop) |
| make | any | macOS: `xcode-select --install` · Linux: `sudo apt install build-essential` |
| openssl | 3+ | pre-installed on macOS/Linux |

### For the `atom` CLI

| Tool | Version | Install |
|------|---------|---------|
| Go | 1.22+ | `brew install go` |

### For Kubernetes mode only

| Tool | Version | Install |
|------|---------|---------|
| kind | any | `brew install kind` |
| kubectl | any | bundled with Docker Desktop |
| helm | 3+ | `brew install helm` |
| golang-migrate | any | `brew install golang-migrate` |
| psql | any | `brew install libpq && brew link libpq --force` |

### For development (building from source)

| Tool | Version | Install |
|------|---------|---------|
| Python 3.11+ | 3.11+ | `brew install python@3.11` |
| uv | any | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| OPA CLI | any | `brew install opa` |
| Node.js | 20+ | `brew install node@20` *(frontend dev only)* |

---

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/shreyasY2k/atom.git && cd atom
make generate-keys              # creates .keys/jwt_private.pem + jwt_public.pem
cp .env.example .env
# Edit .env — set GEMINI_API_KEY (free at aistudio.google.com/app/apikey)
```

### 2. Start the stack

**Docker Compose — operator mode (pulls pre-built GHCR images, no build needed)**
```bash
docker compose up -d
make migrate-dev && make seed-dev
open http://localhost:3000
```

**Docker Compose — developer mode (builds from source)**
```bash
make dev-up
make migrate-dev && make seed-dev
open http://localhost:3000
```

**Kubernetes (kind)**
```bash
make infra-up           # kind cluster + Postgres/Redis/MinIO/Redpanda/OPA/nginx
make k8s-deploy         # build images, load into kind, apply manifests, migrate + seed
make monitoring-up      # Grafana + Loki + Tempo + Alloy
sudo make ingress-hosts # /etc/hosts entries (one-time)
make ingress-up         # expose all services at *.atom.local on port 80
open http://studio.atom.local
```

### 3. Credentials

| Service | Username | Password |
|---------|----------|----------|
| atom-studio | admin@atom.local | **admin123** |
| Grafana | admin | **atom-grafana-dev** |
| MinIO | minioadmin | **changeme** |
| Postgres | atom | **changeme** |

---

## The Core User Journey

Create an agent in the UI, deploy it via CLI, chat with it via GATE.

```
Studio UI ──▶ create domain + agent ──▶ copy JWT token
                                               │
                                               ▼
                                       bin/atom login
                                       bin/atom create   ← scaffold project
                                       # paste JWT into .env
                                       bin/atom deploy   ← build + submit
                                               │
                                     Studio HITL queue (approve)
                                               │
                                               ▼
                                    curl GATE /domain/.../agent/.../run
```

**Step by step:**

```bash
# 1. Install CLI
make cli-build            # → bin/atom

# 2. Login
bin/atom login            # prompts: studio URL, email, password
                          # URL: http://localhost:3001 (docker) or http://api.atom.local (k8s)

# 3. Create agent in Studio UI, copy the JWT token shown once, then scaffold
bin/atom create           # interactive: name, model, tools, HITL config
cd <project-name>/
echo "ATOM_AGENT_JWT=<token>"     >> .env
echo "ATOM_AGENT_ID=<agent-uuid>" >> .env
echo "ATOM_DOMAIN_ID=<domain-uuid>" >> .env

# 4. Deploy (builds Docker image + submits for HITL approval)
bin/atom deploy

# 5. Approve in Studio → HITL queue → Approve

# 6. Chat
curl -X POST http://localhost:8080/domain/<did>/agent/<aid>/run \
  -H "Authorization: Bearer <agent-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'

# 7. Stream live logs
bin/atom logs <agent-id>
```

---

## Try the 4 Example Agents (one command)

```bash
pip install httpx

python examples/provision.py          # Docker Compose
python examples/provision.py --mode k8s  # Kubernetes
```

Provisions instantly: **Financial Assistant**, **Document Summarizer**, **Risk Checker**, **Support Bot**.
Prints exact `curl` commands to chat with each agent. See `examples/README.md`.

---

## Service Map

### Docker Compose

| Service | URL | Credentials |
|---------|-----|-------------|
| atom-studio UI | http://localhost:3000 | admin@atom.local / **admin123** |
| atom-studio API | http://localhost:3001/docs | — |
| GATE | http://localhost:8080 | Bearer JWT |
| atom-llm | http://localhost:4000 | Bearer **sk-atom-dev** |
| Grafana | http://localhost:3005 | **admin** / **atom-grafana-dev** |
| Loki | http://localhost:3100 | — |
| Tempo | http://localhost:3200 | — |
| Alloy UI | http://localhost:12345 | — |
| MinIO console | http://localhost:9001 | **minioadmin** / **changeme** |
| Postgres | localhost:5432 | **atom** / **changeme** |
| Redis | localhost:6379 | password: **changeme** |
| Kafka | localhost:19092 | — |

### Kubernetes (kind — port 80, no port suffix needed)

> Run `sudo make ingress-hosts` once to add `/etc/hosts` entries.

| Service | URL | Credentials |
|---------|-----|-------------|
| atom-studio | http://studio.atom.local | admin@atom.local / **admin123** |
| API / Swagger | http://api.atom.local/docs | — |
| GATE | http://gate.atom.local | Bearer JWT |
| Grafana | http://grafana.atom.local | **admin** / **atom-grafana-dev** |
| Alloy UI | http://alloy.atom.local | — |
| Loki | http://loki.atom.local | — |
| Tempo | http://tempo.atom.local | — |
| MinIO console | http://minio-ui.atom.local | **minioadmin** / **changeme** |
| Postgres | localhost:5432 (TCP ingress) | **atom** / **changeme** |
| Redis | localhost:6379 (TCP ingress) | **changeme** |
| Kafka | localhost:9092 (TCP ingress) | — |

---

## Key Make Targets

```bash
make generate-keys        # JWT RSA key pair (run once)
make bootstrap            # install all dev tools

# Docker Compose
make dev-up / dev-down / dev-down-clean
make migrate-dev          # DB schema
make seed-dev             # admin user + sample domain
make cli-build            # build bin/atom

# Kubernetes
make infra-up             # cluster + infra services
make k8s-deploy           # build, load, apply, migrate, seed
make monitoring-up        # Grafana + Loki + Tempo + Alloy
make ingress-up           # expose *.atom.local
sudo make ingress-hosts   # /etc/hosts (one-time)
make seed-k8s             # re-seed k8s Postgres
make deploy-from-ghcr     # operator deploy (no local build)

# Testing
make test                 # unit + integration
make test-e2e             # E2E (needs running stack)
make test-load            # k6 load test

# Publishing
make ghcr-push            # push images to ghcr.io/shreyasy2k/
```

---

## Operational Procedures

`RUNBOOK.md` covers: JWT rotation, HMAC rotation, adding LLM providers, OPA policies,
scaling GATE, MinIO restore, audit chain validation, agent suspension, cluster rebuild.

---

## Architecture

See `ARCHITECTURE.md` for detailed Mermaid diagrams of:
- System architecture (all services + data flows)
- Deployment flow (CLI → Studio → HITL → atom-runtime → k8s)
- Runtime request flow (caller → GATE → OPA → agent → LLM)
- Agent creation flow
- HITL decision flow
- Audit chain flow
- Memory access flow
- Token lifecycle

```
External caller ──▶ GATE :8080 ──▶ agent pod :8080
                      │ │               │
                      │ └──▶ atom-llm ──▶ LLM provider
                      ▼               ▼
                   Postgres      Kafka ──▶ log-archiver ──▶ MinIO
                   Redis         └──▶ Studio WebSocket (live logs)
                   OPA

Grafana Alloy ──▶ Loki (pod logs) + Tempo (OTLP traces) ──▶ Grafana
```

---

## Repository Layout

```
atom/
├── gate/             Go: JWT auth, OPA, HMAC audit chain, reverse proxy
├── atom-llm/         LiteLLM fork: virtual keys, model routing
├── atom-sdk/         agentscope fork: AtomChatModel, HITL hooks
├── atom-runtime/     k8s/Docker deployment controller
├── atom-memory/      pgvector + Redis memory library
├── atom-studio/      FastAPI backend + React/Vite frontend
├── atom-cli/         Go CLI: login / create / deploy / logs
├── examples/         4 ready-to-run agents + provision.py script
├── infra/            Helm values, k8s manifests, kind config, Grafana dashboards
├── migrations/       golang-migrate SQL (001–012)
├── policies/         OPA Rego policies (hot-reload)
├── tests/            e2e/ + load/
├── docs/             DEVELOPER_GUIDE.md, RUNBOOK.md, SECURITY.md
├── docker-compose.yml      Operator mode (GHCR images)
└── docker-compose.dev.yml  Developer mode (build from source)
```

---

## CLI Reference

```bash
bin/atom login    # authenticate with atom-studio (interactive)
bin/atom create   # scaffold a new agent project (interactive wizard)
bin/atom deploy   # build Docker image + submit deployment for HITL approval
                  #   --agent-id  <uuid>       agent UUID (reads .env if not set)
                  #   --image     <image:tag>   override image name
                  #   --message   <text>        deployment changelog
                  #   --skip-build              skip docker build
bin/atom logs <agent-id>   # stream live logs for a deployed agent
```

---

## Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `GEMINI_API_KEY` | — | **Required** — [get free key](https://aistudio.google.com/app/apikey) |
| `POSTGRES_PASSWORD` | `changeme` | Must match Helm postgres-values.yaml |
| `REDIS_PASSWORD` | `changeme` | Must match Helm redis-values.yaml |
| `PLATFORM_HMAC_SECRET` | pre-set | Do not change after first `make migrate-dev` |
| `ATOM_ENCRYPTION_KEY` | pre-set | Do not change after first `make migrate-dev` |
| `LITELLM_MASTER_KEY` | `sk-atom-dev` | atom-llm admin key |
| `ATOM_LLM_KEY` | `sk-atom-dev` | Same as LITELLM_MASTER_KEY |
| `MINIO_SECRET_KEY` | `changeme` | MinIO root password |
