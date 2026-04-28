# ATOM — Setup & Run Guide

Complete walkthrough for getting the ATOM platform running locally, from a fresh clone to a
working management portal with a live LLM gateway.

---

## Table of Contents

1. [What Is Currently Implemented](#1-what-is-currently-implemented)
2. [Prerequisites](#2-prerequisites)
3. [First-Time Setup](#3-first-time-setup)
4. [Running the Infrastructure Stack](#4-running-the-infrastructure-stack)
5. [Running atom-studio (Management Portal)](#5-running-atom-studio-management-portal)
6. [Verifying the Stack](#6-verifying-the-stack)
7. [Common Workflows](#7-common-workflows)
8. [Port Map](#8-port-map)
9. [Environment Variables Reference](#9-environment-variables-reference)
10. [Troubleshooting](#10-troubleshooting)
11. [What Comes Next (Unimplemented Sessions)](#11-what-comes-next-unimplemented-sessions)

---

## 1. What Is Currently Implemented

Sessions completed as of **SESSION-09**:

| Component | What works |
|---|---|
| **GATE** (Go) | JWT auth, OPA policy enforcement, rate limiting via Redis, HMAC audit chain |
| **atom-llm** | LiteLLM fork with ATOM extensions; Gemini 2.5 Flash / 2.0 Flash configured |
| **atom-studio backend** | FastAPI: user auth, domain management, agent provisioning, HITL queue, deployment approval, real-time WebSocket |
| **atom-studio frontend** | React UI: login, domains, agents wizard, HITL queue, deployment history |
| **Postgres** | All 9 migrations applied; pgvector extension enabled |
| **Redis** | Rate limit counters, token revocation, refresh tokens |
| **OPA** | agent_auth, domain_isolation, tool_access policies loaded |
| **atom-sdk** | Forked agentscope (agent framework — library, not a running service) |

**Not yet implemented** (future sessions): atom-cli (SESSION-10), atom-runtime
(SESSION-11), atom-memory (SESSION-12), monitoring/OTEL (SESSION-13), Kafka pipeline
(SESSION-14), E2E tests (SESSION-15).

---

## 2. Prerequisites

Install all of the following before beginning.

### Required tools

| Tool | Min version | Install |
|---|---|---|
| Docker Desktop | 24+ | https://www.docker.com/products/docker-desktop |
| Go | 1.22+ | `brew install go` |
| Python | 3.11+ | `brew install python@3.11` |
| uv (Python package manager) | any | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Node.js | 20+ | `brew install node@20` |
| OpenSSL | 3+ | pre-installed on macOS/Linux |
| golang-migrate | latest | `brew install golang-migrate` |
| psql (PostgreSQL client) | any | `brew install libpq && brew link libpq --force` |

### Verify tools

```bash
docker --version       # Docker version 24+
go version             # go1.22+
python3 --version      # Python 3.11+
uv --version           # any
node --version         # v20+
migrate -version       # v4+
psql --version         # any
```

---

## 3. First-Time Setup

### 3.1 Clone the repo

```bash
git clone <your-repo-url> atom
cd atom
```

### 3.2 Clone upstream forks (run once)

The repo contains placeholder directories for five upstream forks. This script clones them:

```bash
bash scripts/clone-upstreams.sh
```

This clones:
- `atom-llm/` ← BerriAI/litellm
- `atom-sdk/` ← agentscope-ai/agentscope
- `atom-runtime/` ← agentscope-ai/agentscope-runtime
- `atom-memory/` ← agentscope-ai/agentscope (memory module)
- `agentscope-studio/` ← agentscope-ai/agentscope-studio (trace viewer, unmodified)

If the script fails for any component, you can clone it manually:

```bash
# atom-llm (LiteLLM fork — most important)
git clone https://github.com/BerriAI/litellm.git atom-llm
```

### 3.3 Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. The critical ones:

```bash
# ── Required: set a real LLM API key ────────────────────────────────────────
# The dev stack uses Gemini by default. Get a free key at:
# https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your-key-here

# ── Optional: change default passwords (recommended in any shared env) ───────
POSTGRES_PASSWORD=changeme       # also used in DATABASE_URL below
REDIS_PASSWORD=changeme          # also used in REDIS_URL below

# ── These are pre-filled and should work as-is ───────────────────────────────
DATABASE_URL=postgresql://atom:changeme@localhost:5432/atom?sslmode=disable
REDIS_URL=redis://:changeme@localhost:6379
ATOM_LLM_KEY=sk-atom-dev
LITELLM_MASTER_KEY=sk-atom-dev
```

> **Note:** The `.env` file already contains a working `ATOM_ENCRYPTION_KEY` and
> `PLATFORM_HMAC_SECRET`. Only change them if you understand what they do (see RUNBOOK.md
> §1 and §2 for rotation procedures).

### 3.4 Generate JWT key pair

```bash
make generate-keys
```

This creates `.keys/jwt_private.pem` and `.keys/jwt_public.pem`. These files are in
`.gitignore` — never commit them. The private key signs agent JWTs in atom-studio; the
public key is used by GATE to verify them.

---

## 4. Running the Infrastructure Stack

### 4.1 Start all services with docker compose

```bash
make dev-up
# or equivalently:
docker compose -f docker-compose.dev.yml up -d
```

This starts (with health-checks and dependency ordering):

| Container | Purpose | Port |
|---|---|---|
| `atom-postgres` | PostgreSQL 16 + pgvector | 5432 |
| `atom-redis` | Redis 7 (rate limits, token revocation) | 6379 |
| `atom-minio` | S3-compatible object store (audit archive) | 9000, 9001 |
| `atom-redpanda` | Kafka-compatible event streaming | 9092 |
| `atom-opa` | OPA policy engine (server mode) | 8181 |
| `atom-gate` | GATE service (Go) | 8080 |
| `atom-llm` | LiteLLM + ATOM extensions | 4000 |
| `atom-studio-api` | Studio FastAPI backend | 3001 |
| `atom-studio-ui` | Studio React frontend (nginx) | 3000 |

> **First run is slow.** Docker images for `atom-llm` and `atom-gate` must be built
> from source. Expect 3–5 minutes on first run.

Wait for everything to be healthy:

```bash
docker compose -f docker-compose.dev.yml ps
# All services should show "Up" or "Up (healthy)"
```

### 4.2 Apply database migrations

The postgres container starts empty. Run migrations to create all ATOM tables:

```bash
make migrate-up
```

This applies all 9 migrations in `migrations/` using golang-migrate. You should see:

```
✓ Migrations applied.
```

Verify the schema was created:

```bash
psql "postgresql://atom:changeme@localhost:5432/atom" -c "\dt" | grep -v LiteLLM
```

Expected ATOM tables: `users`, `domains`, `agents`, `agent_tokens`, `agent_tools`,
`agent_skills`, `policies`, `tools`, `skills`, `memory_configs`, `hitl_workflows`,
`deployments`, `audit_log_chain`, `memory_vectors`.

### 4.3 (Optional) Load seed data

Creates a default admin user and a sample domain for local testing:

```bash
make seed-dev
```

---

## 5. Running atom-studio (Management Portal)

The management portal has a **backend** (FastAPI) and a **frontend** (React).

### Option A — Development mode (recommended for active development)

Run backend and frontend separately for hot-reload:

#### Backend (terminal 1)

```bash
cd atom/atom-studio/backend
uv run uvicorn atom_studio.main:app --reload --port 3001
```

You should see:
```
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:3001
```

#### Frontend (terminal 2)

```bash
cd atom/atom-studio/frontend
npm install          # first time only
npm run dev
```

You should see:
```
  ➜  Local:   http://localhost:5173/
```

Open http://localhost:5173 in your browser.

> The Vite dev server proxies `/api` → `http://localhost:3001` and `/ws` →
> `ws://localhost:3001` automatically, so no CORS configuration is needed.

### Option B — Docker (production-like)

The `make dev-up` stack already includes `atom-studio-api` (port 3001) and
`atom-studio-ui` (port 3000, served via nginx). No extra steps needed.

Open http://localhost:3000 in your browser.

### First login

If you loaded seed data (`make seed-dev`), use:
- Email: `admin@atom.local`
- Password: `changeme`

If not, register via the API:

```bash
curl -s -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret","full_name":"Admin","role":"admin"}' \
  | jq .
```

---

## 6. Verifying the Stack

Run these checks in order to confirm each layer is working.

### 6.1 Postgres

```bash
psql "postgresql://atom:changeme@localhost:5432/atom" -c "SELECT count(*) FROM users;"
```
→ Returns a number (0 if no seed data).

### 6.2 Redis

```bash
redis-cli -a changeme ping
```
→ `PONG`

### 6.3 OPA

```bash
curl -s http://localhost:8181/v1/health
```
→ `{}`  (empty body = healthy)

### 6.4 GATE

```bash
curl -s http://localhost:8080/healthz
```
→ `{"status":"ok"}`

### 6.5 atom-llm (LiteLLM)

```bash
curl -s http://localhost:4000/health/liveliness
```
→ `"I'm alive!"`

List configured models:

```bash
curl -s -H "Authorization: Bearer sk-atom-dev" http://localhost:4000/models \
  | jq '[.data[].id]'
```
→ `["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-001"]`

Test an actual LLM call:

```bash
curl -s -X POST http://localhost:4000/chat/completions \
  -H "Authorization: Bearer sk-atom-dev" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-2.5-flash","messages":[{"role":"user","content":"Say hi in one word"}]}' \
  | jq '.choices[0].message.content'
```

### 6.6 atom-studio backend

```bash
curl -s http://localhost:3001/healthz
```
→ `{"status":"ok"}`

```bash
# Login and get a token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret"}' | jq -r '.access_token')

# List domains
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/domains/
```

### 6.7 Run backend tests

```bash
uv run --project atom-studio/backend --directory . \
  pytest atom-studio/backend/src/tests/ -v
```

→ All 52 tests should pass.

> **Important:** Run tests from the project root (`atom/`), not from inside
> `atom-studio/backend/`. The `.env` file with relative JWT key paths must be
> resolved from the project root.

---

## 7. Common Workflows

### Create a domain and agent via the Studio UI

1. Open http://localhost:5173 (dev) or http://localhost:3000 (docker)
2. Log in
3. Click **Domains** → **New Domain** → fill name + description
4. Click into the domain → **New Agent** → follow the 7-step wizard
5. Copy the JWT token shown at the end (shown once, store it safely)

### Create a domain and agent via curl

```bash
# 1. Login
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"secret"}' | jq -r '.access_token')

# 2. Create domain (provisions a LiteLLM team)
DOMAIN=$(curl -s -X POST http://localhost:3001/api/domains/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-domain","description":"Test domain"}' | jq -r '.id')

# 3. Create agent (provisions LiteLLM virtual key + issues JWT)
AGENT_RESP=$(curl -s -X POST http://localhost:3001/api/domains/$DOMAIN/agents/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"loan-agent","allowed_models":["gemini-2.5-flash"],"hitl_timeout_seconds":300}')

AGENT_JWT=$(echo $AGENT_RESP | jq -r '.token')
AGENT_ID=$(echo $AGENT_RESP | jq -r '.agent.id')

echo "Agent JWT: $AGENT_JWT"
```

### Submit a HITL decision request (simulating an agent)

```bash
# Agent code would call this when it needs a human decision
curl -s -X POST http://localhost:3001/api/hitl/request \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "'$AGENT_ID'",
    "workflow_type": "BUSINESS_DECISION",
    "payload": {"action": "approve_loan", "amount": 50000, "customer_id": "4821"},
    "timeout_s": 300
  }'
```

Then open the Studio UI → **HITL Queue** to see the decision appear in real time.

### Submit a deployment request

```bash
curl -s -X POST http://localhost:3001/api/deployments/$AGENT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"image":"registry.example.com/loan-agent:abc123","git_sha":"abc123","message":"Initial deploy"}'
```

This creates a HITL workflow of type `DEPLOYMENT_APPROVAL` and updates the agent status to `pending_approval`.

### Stop the dev stack

```bash
make dev-down
# or:
docker compose -f docker-compose.dev.yml down
```

To also remove volumes (wipes database and Redis):

```bash
docker compose -f docker-compose.dev.yml down -v
```

---

## 8. Port Map

| Port | Service | What it serves |
|---|---|---|
| **5432** | Postgres | ATOM schema + LiteLLM tables |
| **6379** | Redis | Rate limits, token revocation, refresh tokens |
| **8080** | GATE | All agent traffic (JWT auth + policy + audit) |
| **8181** | OPA | Policy evaluation (REST API) |
| **4000** | atom-llm | LLM gateway (LiteLLM proxy) |
| **3001** | atom-studio backend | Studio REST API + WebSocket |
| **5173** | atom-studio frontend (dev) | Vite hot-reload dev server |
| **3000** | atom-studio frontend (docker) | nginx production build |
| **9000** | MinIO | S3-compatible object store API |
| **9001** | MinIO console | Web UI for bucket management |
| **9092** | Redpanda | Kafka-compatible broker |
| **3002** | agentscope-studio | Trace/conversation viewer |

---

## 9. Environment Variables Reference

Full list of variables in `.env`. Most are pre-filled. Change only what's needed.

### Database & Cache

| Variable | Default | Required |
|---|---|---|
| `DATABASE_URL` | `postgresql://atom:changeme@localhost:5432/atom?sslmode=disable` | Yes |
| `REDIS_URL` | `redis://:changeme@localhost:6379` | Yes |
| `POSTGRES_PASSWORD` | `changeme` | Matches DATABASE_URL |
| `REDIS_PASSWORD` | `changeme` | Matches REDIS_URL |

### JWT & Encryption

| Variable | Default | Required |
|---|---|---|
| `JWT_PRIVATE_KEY_PATH` | `./.keys/jwt_private.pem` | Yes — `make generate-keys` |
| `JWT_PUBLIC_KEY_PATH` | `./.keys/jwt_public.pem` | Yes — `make generate-keys` |
| `ATOM_ENCRYPTION_KEY` | (pre-generated 32-byte hex) | Yes — do not change after first run |
| `PLATFORM_HMAC_SECRET` | (pre-generated 32-byte hex) | Yes — do not change after first run |

### LLM Gateway

| Variable | Default | Required |
|---|---|---|
| `GEMINI_API_KEY` | — | Yes (for default Gemini models) |
| `ATOM_LLM_KEY` | `sk-atom-dev` | Master key for atom-llm admin calls |
| `LITELLM_MASTER_KEY` | `sk-atom-dev` | Must match `ATOM_LLM_KEY` |
| `ATOM_LLM_URL` | `http://localhost:4000` | URL agents use to reach atom-llm |

### Service URLs

| Variable | Default | Description |
|---|---|---|
| `ATOM_STUDIO_API_URL` | `http://localhost:3001` | Studio API URL (used by GATE) |
| `ATOM_MEMORY_URL` | `http://localhost:8000` | Memory service (SESSION-12, not yet running) |
| `ATOM_RUNTIME_URL` | `http://localhost:8090` | Runtime service (SESSION-11, not yet running) |

### Object Store & Streaming

| Variable | Default |
|---|---|
| `MINIO_ENDPOINT` | `http://localhost:9000` |
| `MINIO_ACCESS_KEY` | `minioadmin` |
| `MINIO_SECRET_KEY` | `changeme` |
| `KAFKA_BROKERS` | `localhost:9092` |

---

## 10. Troubleshooting

### `docker compose up` fails — port already in use

```bash
# Find what's using the port
lsof -i :5432     # or whatever port is conflicting
# Stop the conflicting service, then retry
```

### `make migrate-up` fails — "no such host: localhost"

Postgres isn't ready yet. Wait until `atom-postgres` shows `(healthy)`:

```bash
docker compose -f docker-compose.dev.yml ps | grep postgres
# Wait until: atom-postgres   Up (healthy)
```

### `atom-llm` container keeps restarting

Check logs:

```bash
docker logs atom-llm --tail 50
```

Common cause: missing `GEMINI_API_KEY` in `.env`. The container starts but LiteLLM
logs an error on the first LLM call (not on startup), so the container itself stays up.
Verify by making a test call and checking the response.

### Studio backend: `FileNotFoundError: .keys/jwt_private.pem`

This happens when uvicorn is started from the wrong directory. Always start it from the
project root (`atom/`) or use the full absolute path:

```bash
# From project root:
cd atom
uv run --directory atom-studio/backend uvicorn atom_studio.main:app --reload --port 3001

# Or set absolute paths in .env:
JWT_PRIVATE_KEY_PATH=/absolute/path/to/atom/.keys/jwt_private.pem
```

### Tests fail: `FileNotFoundError: .keys/jwt_private.pem`

Run tests from the project root, not from inside `atom-studio/backend/`:

```bash
# Correct:
cd atom
uv run --project atom-studio/backend --directory . pytest atom-studio/backend/src/tests/

# Wrong (JWT paths don't resolve):
cd atom-studio/backend && uv run pytest src/tests/
```

### LiteLLM provisioning fails when creating an agent

```
RuntimeError: LiteLLM agent provisioning failed
```

atom-llm must be running and reachable. Verify:

```bash
curl -s http://localhost:4000/health/liveliness
```

If using docker compose, check `ATOM_LLM_URL=http://atom-llm:4000` in the container
environment (the internal docker hostname). In local dev, use `http://localhost:4000`.

### OPA returns 404 on `/v1/health`

The OPA version used may not have the `/v1/health` endpoint. Use:

```bash
curl -s http://localhost:8181/health
# or just check the container is up:
docker ps | grep opa
```

### GATE returns 401 on every request

Most likely the JWT public key isn't mounted. Verify:

```bash
docker exec atom-gate ls /etc/atom/
# Should show: jwt_public.pem
```

If missing, the `.keys/` volume mount in `docker-compose.dev.yml` failed. Check that
`.keys/jwt_public.pem` exists:

```bash
ls .keys/
# Should show: jwt_private.pem  jwt_public.pem
# If missing: make generate-keys
```

---

## 11. What Comes Next (Unimplemented Sessions)

These sessions are planned but not yet built. Services that depend on them will return
errors until they're implemented.

| Session | What it adds | Blocking |
|---|---|---|
| **SESSION-10** | `atom-cli` — `atom create`, `atom login`, `atom deploy` | atom-cli binary |
| **SESSION-11** | `atom-runtime` — k8s agent deployment controller | `POST /api/runtime/deploy-result` |
| **SESSION-12** | `atom-memory` — pgvector long-term + Redis short-term memory | Memory endpoints in agents |
| **SESSION-13** | OTEL + Grafana monitoring stack | Observability |
| **SESSION-14** | Kafka audit log pipeline + MinIO archive | Streaming audit trail |
| **SESSION-15** | E2E tests + hardening | Production readiness |

**What works without future sessions:**
- Creating domains and agents via Studio UI
- Issuing and revoking agent JWTs
- HITL business decision queue with real-time WebSocket updates
- Deployment approval workflow (approval side only; deployment execution needs SESSION-11)
- LLM calls through atom-llm (Gemini, or any provider with an API key)
- GATE authentication and OPA policy enforcement
- Agent audit chain (entries written to Postgres on every GATE request)

---

## Quick Reference Card

```bash
# First-time setup
cp .env.example .env && vim .env          # set GEMINI_API_KEY
make generate-keys                         # create JWT key pair
bash scripts/clone-upstreams.sh           # clone forks (once)

# Start everything
make dev-up                               # start docker stack
make migrate-up                           # apply DB schema

# Studio (dev mode, hot-reload)
uv run --directory atom-studio/backend uvicorn atom_studio.main:app --reload --port 3001
cd atom-studio/frontend && npm run dev    # http://localhost:5173

# Run tests (from project root)
uv run --project atom-studio/backend --directory . pytest atom-studio/backend/src/tests/

# Health checks
curl http://localhost:8080/healthz        # GATE
curl http://localhost:4000/health/liveliness  # atom-llm
curl http://localhost:3001/healthz        # studio API

# Stop
make dev-down                             # stop containers, keep volumes
docker compose -f docker-compose.dev.yml down -v  # stop + wipe data
```
