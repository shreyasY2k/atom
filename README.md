# ATOM — Agentic Transformation & Operations Manager

A BFSI-grade platform for developing, governing, and deploying AI agents.
Every LLM call flows through **GATE** — authenticated, policy-checked, rate-limited, and immutably audit-logged.

---

## Prerequisites

| Tool | Why | Install |
|------|-----|---------|
| Docker Desktop 24+ | runs the entire stack | [docker.com](https://www.docker.com/products/docker-desktop) |
| Go 1.22+ | builds the `atom` CLI | `brew install go` |
| Python 3.11+ | agent code + dev tooling | `brew install python@3.11` |
| openssl | JWT key generation | pre-installed on macOS/Linux |

> **Kubernetes only:** also install `kind`, `kubectl`, `helm`, `golang-migrate`, `psql` — see [docs/SETUP.md](docs/SETUP.md).

---

## Start the stack

### Docker Compose (recommended)

```bash
# 1. Clone
git clone https://gitlab.com/shreyasy2k/atom.git && cd atom

# 2. Generate keys and configure
cp .env.example .env
make generate-keys
# Edit .env — set GEMINI_API_KEY  (free key: aistudio.google.com/app/apikey)
# Also set ATOM_ENCRYPTION_KEY and PLATFORM_HMAC_SECRET:
#   openssl rand -hex 32   (run twice, one value per variable)

# 3. Start everything (builds images, runs migrations + seed automatically)
make dev-up

# 4. Open Studio
open http://localhost:3000  # admin@atom.local / admin123
```

**Migrations run automatically** on every `make dev-up` — no manual migration steps needed.

To wipe all data and start fresh:
```bash
make dev-down && make dev-reset-db && make dev-up
```

### Kubernetes (kind)

```bash
cp .env.example .env && make generate-keys   # then set GEMINI_API_KEY in .env
make infra-up                                # kind cluster + infra (Postgres, Redis, etc.)
make k8s-deploy                              # deploy all services (migrations auto-run)
make monitoring-up                           # Grafana + Loki + Tempo
sudo make ingress-hosts && make ingress-up   # *.atom.local on port 80

open http://studio.atom.local               # admin@atom.local / admin123
```

---

## Create and run your first agent

### Step 1 — Build the CLI and login

```bash
make cli-build              # → bin/atom
bin/atom login
# Prompts for Studio URL, email, password
# Docker: http://localhost:3001 · k8s: http://api.atom.local
```

### Step 2 — Create a domain and agent in Studio

```
Open http://localhost:3000  (or http://studio.atom.local for k8s)

Domains → New Domain → pick a name
Agents  → New Agent  → fill the wizard
         → copy the one-time JWT token shown at the end
         → note the domain UUID and agent UUID from the URL
```

### Step 3 — Scaffold the agent project

```bash
bin/atom create             # interactive: name, model, tools, HITL
# atom create automatically creates .venv and installs atom-platform-sdk + deps
cd <project-name>/
source .venv/bin/activate
```

### Step 4 — Fill in credentials and run

```bash
# Edit .env — fill in the values from Studio:
# ATOM_GATE_URL=http://localhost:8080
# ATOM_DOMAIN_ID=<domain-uuid>
# ATOM_AGENT_ID=<agent-uuid>
# ATOM_AGENT_JWT=<token-from-studio>
# ATOM_MODEL_NAME=gemini-2.5-flash

python agent.py
# Conversations appear in Studio → Agents → Conversations tab
```

### Step 5 — Deploy and chat via GATE

#### Local Docker build (default)
```bash
# From inside the agent directory:
../bin/atom deploy          # docker build → submit for HITL approval

# Studio → HITL queue → Approve

# Chat through GATE (docker-compose)
curl -X POST http://localhost:8080/domain/<domain-id>/agent/<agent-id>/run \
  -H "Authorization: Bearer <agent-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'

../bin/atom logs <agent-id> # stream live logs
```

---

## Try 4 example agents instantly

```bash
pip install httpx
python examples/provision.py          # docker-compose
python examples/provision.py --mode k8s  # kubernetes
```

Creates: **Financial Assistant**, **Document Summarizer**, **Risk Checker**, **Customer Support Bot** — all deployed, credentials printed, ready to chat. See `examples/README.md`.

---

## Services and credentials

### Docker Compose

| Service | URL | Login |
|---------|-----|-------|
| atom-studio | http://localhost:3000 | admin@atom.local / **admin123** |
| GATE | http://localhost:8080 | Bearer JWT |
| atom-llm | http://localhost:4000 | Bearer **sk-atom-master-changeme** (LITELLM_MASTER_KEY) |
| Grafana | http://localhost:3005 | admin / **atom-grafana-dev** |
| MinIO console | http://localhost:9001 | minioadmin / **changeme** |
| Postgres | localhost:5432 | atom / **changeme** |

### Kubernetes (after `sudo make ingress-hosts`)

| Service | URL | Login |
|---------|-----|-------|
| atom-studio | http://studio.atom.local | admin@atom.local / **admin123** |
| GATE | http://gate.atom.local | Bearer JWT |
| Grafana | http://grafana.atom.local | admin / **atom-grafana-dev** |
| MinIO console | http://minio-ui.atom.local | minioadmin / **changeme** |
| Postgres | localhost:5432 (TCP via ingress) | atom / **changeme** |

---

## CLI

```bash
bin/atom login              # authenticate (prompts for Studio URL, email, password)
bin/atom create             # scaffold a new agent project (interactive wizard)
                            # → creates atom_agent.yaml, Dockerfile, tools.py …
bin/atom deploy             # build image locally + submit for HITL approval
  --agent-id <uuid>         # (reads atom_agent.yaml / .env if not set)
  --image    <name:tag>     # override image name
  --message  "text"         # changelog note
  --skip-build              # skip docker build, use existing image
bin/atom sdk upgrade        # update sdk_image in atom_agent.yaml to :latest
bin/atom sdk upgrade v0.2.0 # pin to a specific atom-sdk release tag
bin/atom logs <agent-id>    # stream live logs from a deployed agent
```

Install without building:
```bash
curl -fsSL https://github.com/shreyasY2k/atom/releases/latest/download/atom_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/').tar.gz \
  | tar -xz -C /usr/local/bin atom
```

---

## atom-sdk (Python)

```bash
# Install from GitHub (no PyPI needed)
pip install "git+https://github.com/shreyasY2k/atom.git#subdirectory=atom-sdk/atom_platform_sdk"
```

---

## Detailed documentation

| Doc | What's in it |
|-----|-------------|
| [docs/SETUP.md](docs/SETUP.md) | Full setup guide for docker-compose and k8s, verification steps, troubleshooting |
| [docs/CI_BUILD.md](docs/CI_BUILD.md) | GitLab CI image build guide — private repos, SDK versioning, cross-group registry, k8s imagePullSecrets |
| [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) | Building agents, SDK patterns, tools, OPA policies |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | JWT rotation, HMAC rotation, adding LLM providers, scaling, restoring data |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Mermaid diagrams for every flow (request, deployment, HITL, audit chain) |
| [docs/SECURITY.md](docs/SECURITY.md) | Security hardening checklist |
| [docs/kafka-schemas.md](docs/kafka-schemas.md) | Kafka topic message schemas |
| [docs/decisions/](docs/decisions/) | Architecture Decision Records (ADR-001 … ADR-015) |
| [examples/README.md](examples/README.md) | Example agents + provision script |

---

## Repository layout

```
atom/
├── gate/              Go: JWT auth, OPA, rate-limit, HMAC audit chain, proxy
├── atom-llm/          LiteLLM fork: virtual keys, model routing to LLM providers
├── atom-sdk/          agentscope fork: AtomChatModel, HITL hooks, Toolkit
├── atom-runtime/      Deployment controller: k8s pods or Docker containers
├── atom-memory/       pgvector (long-term) + Redis (short-term) memory library
├── atom-studio/       FastAPI API + React UI: domains, agents, HITL, audit, runs
├── atom-cli/          Go CLI: login / create / deploy / logs
├── examples/          4 BFSI example agents + provision.py
├── infra/             Helm values, k8s manifests, Grafana dashboards, kind config
├── migrations/        Database schema (SQL, 001–012)
├── policies/          OPA Rego policies (GATE hot-reloads within 5s)
├── tests/             E2E tests (pytest) + load tests (k6)
├── docs/              SETUP, ARCHITECTURE, RUNBOOK, DEVELOPER_GUIDE, SECURITY, kafka-schemas
│   └── decisions/     Architecture Decision Records (ADR-001 … ADR-015)
├── docker-compose.yml       Operator mode — pulls GHCR images
└── docker-compose.dev.yml   Developer mode — builds from source
```
