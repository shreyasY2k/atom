# ATOM — Setup & Run Guide

Complete walkthrough for getting ATOM running locally via **docker-compose** (dev)
or **Kubernetes** (prod-like).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [First-Time Setup](#2-first-time-setup)
3. [Mode A — Docker Compose](#3-mode-a--docker-compose-local-dev)
4. [Mode B — Kubernetes](#4-mode-b--kubernetes-docker-desktop)
5. [Service URLs & Credentials](#5-service-urls--credentials)
6. [Verifying the Stack](#6-verifying-the-stack)
7. [Common Workflows](#7-common-workflows)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Prerequisites

| Tool | Min version | Install |
|------|-------------|---------|
| Docker Desktop | 24+ | https://www.docker.com/products/docker-desktop |
| Go | 1.22+ | `brew install go` |
| Python | 3.11+ | `brew install python@3.11` |
| uv | any | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| kubectl | any | bundled with Docker Desktop |
| helm | 3+ | `brew install helm` |
| OPA | any | `brew install opa` |
| golang-migrate | any | `brew install golang-migrate` |
| psql | any | `brew install libpq && brew link libpq --force` |
| k6 *(load tests)* | any | `brew install k6` |

```bash
# Verify
docker version && go version && python3 --version
kubectl version --client && helm version && opa version
migrate -version && psql --version
```

---

## 2. First-Time Setup

### 2.1 Clone

```bash
git clone https://github.com/shreyasY2k/atom.git && cd atom
```

### 2.2 Generate JWT key pair (required for both modes)

```bash
make generate-keys
# Creates .keys/jwt_private.pem + .keys/jwt_public.pem
# These files are gitignored — never commit them.
```

### 2.3 Configure environment

```bash
cp .env.example .env
```

Edit `.env` — **only these are mandatory** for a minimal working setup:

```bash
GEMINI_API_KEY=your-key-here   # get free key at aistudio.google.com/app/apikey

# Defaults below work for local dev — change only if you want custom passwords:
POSTGRES_PASSWORD=changeme
REDIS_PASSWORD=changeme
MINIO_SECRET_KEY=changeme
LITELLM_MASTER_KEY=sk-atom-dev
ATOM_LLM_KEY=sk-atom-dev
```

> `PLATFORM_HMAC_SECRET` and `ATOM_ENCRYPTION_KEY` are pre-generated in the template.
> Do **not** change them after your first `make migrate-dev` — they protect the audit chain
> and encrypted keys in the database.

---

## 3. Mode A — Docker Compose (local dev)

### Start

```bash
make dev-up          # ~20 containers; first run builds images (3–5 min)
make migrate-dev     # apply DB schema (run once after first dev-up)
make seed-dev        # load admin user + sample data (run once)
```

### Access

Open **http://localhost:3000** — login: `admin@atom.local` / `admin123`

### Stop

```bash
make dev-down           # stop containers, keep volumes (data persists)
make dev-down-clean     # stop + wipe all volumes (full reset)
```

### Hot-reload development

```bash
# Frontend with Vite hot-reload
cd atom-studio/frontend && npm install && npm run dev
# → http://localhost:5173  (proxies /api → localhost:3001 automatically)

# Backend with uvicorn reload
cd atom && uv run --project atom-studio/backend \
  uvicorn atom_studio.main:app --reload --port 3001
```

---

## 4. Mode B — Kubernetes (Docker Desktop)

Docker Desktop's built-in Kubernetes cluster is used (3-node kind-backed).

### 4.1 Deploy infrastructure (once per cluster)

```bash
make infra-up
# Installs via Helm: Postgres, Redis, MinIO, Redpanda, OPA, nginx-ingress
# Namespace: atom-infra + atom-system + atom-agents
```

### 4.2 Deploy application services

```bash
make k8s-deploy
# Builds 6 Docker images, applies k8s manifests, runs DB migrations + seed,
# waits for all rollouts (gate×3, atom-llm×2, studio-api, studio-ui, runtime, archiver)
```

### 4.3 Deploy monitoring stack (optional but recommended)

```bash
make monitoring-up
# Deploys via Helm: Grafana, Loki, Tempo + Alloy (OTLP receiver)
```

### 4.4 Set up ingress (once per machine)

```bash
# Apply ingress rules + start port-forward (run each session)
make ingress-up

# Write /etc/hosts entries (one-time, needs sudo)
sudo make ingress-hosts
# Adds: 127.0.0.1  gate.atom.local api.atom.local studio.atom.local ...
```

### 4.5 Access

Open **http://studio.atom.local:8088** — login: `admin@atom.local` / `admin123`

### Re-running seed only

```bash
make seed-k8s
# Port-forwards Postgres, runs seed_dev.sql, cleans up
```

### Checking cluster state

```bash
kubectl get pods -n atom-system    # application pods
kubectl get pods -n atom-infra     # Postgres, Redis, MinIO, Redpanda, OPA
kubectl get ingress -A             # ingress routes
```

---

## 5. Service URLs & Credentials

### Docker Compose

| Service | URL | Username | Password |
|---------|-----|----------|----------|
| atom-studio UI | http://localhost:3000 | admin@atom.local | **admin123** |
| atom-studio API / Swagger | http://localhost:3001/docs | — | — |
| GATE | http://localhost:8080 | — | Bearer JWT |
| atom-llm | http://localhost:4000 | — | Bearer **sk-atom-dev** |
| atom-runtime | http://localhost:8090 | — | — |
| Grafana | http://localhost:3005 | **admin** | **admin** |
| Alloy UI | http://localhost:12345 | — | — |
| Loki API | http://localhost:3100 | — | — |
| Tempo API | http://localhost:3200 | — | — |
| MinIO console | http://localhost:9001 | **minioadmin** | **changeme** |
| MinIO S3 API | http://localhost:9000 | **minioadmin** | **changeme** |
| OPA | http://localhost:8181 | — | — |
| Postgres | localhost:5432 | **atom** | **changeme** (DB: `atom`) |
| Redis | localhost:6379 | — | **changeme** |
| Kafka | localhost:19092 | — | — (SASL disabled in dev) |

### Kubernetes (via `make ingress-up` on port 8088)

> All HTTP services are reachable at `http://<name>.atom.local:8088` after
> `make ingress-up` and `sudo make ingress-hosts`.

| Service | URL | Username | Password |
|---------|-----|----------|----------|
| atom-studio (UI + API) | http://studio.atom.local:8088 | admin@atom.local | **admin123** |
| atom-studio API / Swagger | http://api.atom.local:8088/docs | — | — |
| GATE | http://gate.atom.local:8088 | — | Bearer JWT |
| atom-runtime | http://runtime.atom.local:8088/healthz | — | — |
| Grafana | http://grafana.atom.local:8088 | **admin** | **atom-grafana-dev** |
| Alloy UI | http://alloy.atom.local:8088 | — | — |
| Loki API | http://loki.atom.local:8088 | — | — |
| Tempo API | http://tempo.atom.local:8088 | — | — |
| MinIO console | http://minio-ui.atom.local:8088 | **minioadmin** | **changeme** |
| MinIO S3 API | http://minio.atom.local:8088 | **minioadmin** | **changeme** |
| OPA | http://opa.atom.local:8088 | — | — |
| Postgres | localhost:**5432** (TCP) | **atom** | **changeme** (DB: `atom`) |
| Redis | localhost:**6379** (TCP) | — | **changeme** |
| Kafka | localhost:**9092** (TCP) | — | — |

> TCP services (Postgres, Redis, Kafka) route through the nginx-ingress TCP ConfigMap.
> They are available at `localhost:<port>` when `make ingress-up` is active — no
> separate port-forward needed.

### /etc/hosts (k8s mode)

```
# Add once with: sudo make ingress-hosts
127.0.0.1  gate.atom.local api.atom.local studio.atom.local runtime.atom.local
127.0.0.1  grafana.atom.local alloy.atom.local loki.atom.local tempo.atom.local
127.0.0.1  minio.atom.local minio-ui.atom.local opa.atom.local
```

---

## 6. Verifying the Stack

### Docker Compose

```bash
# Postgres
psql "postgresql://atom:changeme@localhost:5432/atom" -c "SELECT count(*) FROM users;"
# → 1 (after seed-dev)

# Redis
redis-cli -a changeme ping    # → PONG

# GATE
curl http://localhost:8080/healthz    # → {"status":"ok"}

# atom-llm
curl -H "Authorization: Bearer sk-atom-dev" http://localhost:4000/health/readiness
# → {"status":"healthy","checks":{...}}

# Studio API
curl http://localhost:3001/healthz    # → {"status":"ok"}

# Login
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' | python3 -m json.tool
```

### Kubernetes

```bash
# All app pods running?
kubectl get pods -n atom-system

# Ingress routes correct?
kubectl get ingress -A

# Studio login via ingress
curl -s -X POST -H "Host: studio.atom.local" http://localhost:8088/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' | python3 -m json.tool

# Or with /etc/hosts set up:
curl -s -X POST http://studio.atom.local:8088/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' | python3 -m json.tool
```

---

## 7. Common Workflows

### Create a domain and agent via curl

```bash
# 1. Login (k8s)
TOKEN=$(curl -s -X POST http://studio.atom.local:8088/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Or docker-compose:
# TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login ...)

# 2. Create domain
DOMAIN=$(curl -s -X POST http://studio.atom.local:8088/api/domains/ \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-domain","description":"Test"}' | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['id'])")

# 3. Create agent
RESP=$(curl -s -X POST "http://studio.atom.local:8088/api/domains/$DOMAIN/agents/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-agent","allowed_models":["gemini-2.5-flash"],"rpm_limit":60}')
AGENT_JWT=$(echo $RESP | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
AGENT_ID=$(echo $RESP | python3 -c "import sys,json; print(json.load(sys.stdin)['agent']['id'])")
```

### Deploy an agent via CLI

```bash
make cli-build   # builds bin/atom

bin/atom deploy \
  --agent-id $AGENT_ID \
  --skip-build \
  --image hashicorp/http-echo:latest \
  --message "test deploy"

# Approve in Studio HITL queue
open http://studio.atom.local:8088/hitl

# Wait for pod
kubectl wait --for=condition=available \
  deployment/agent-$AGENT_ID -n atom-agents --timeout=120s
```

### Call a deployed agent through GATE

```bash
curl -X POST "http://gate.atom.local:8088/domain/$DOMAIN/agent/$AGENT_ID/echo" \
  -H "Authorization: Bearer $AGENT_JWT" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello"}'
```

---

## 8. Troubleshooting

**Cannot log in — 401 Unauthorized**
```bash
# Re-run seed (k8s)
make seed-k8s
# Credentials: admin@atom.local / admin123
```

**Studio UI loads but API calls return 404 / 502**
```bash
# Ingress must route /api on studio.atom.local to atom-studio-api
kubectl get ingress atom-system-ingress -n atom-system -o yaml | grep -A5 "studio.atom.local"
# Should show paths: /api, /ws, /
# If wrong, re-apply: kubectl apply -f infra/manifests/ingress.yaml
```

**`make ingress-up` has no effect (still can't reach URLs)**
```bash
# Verify port-forward is running
lsof -ti:8088
# Verify /etc/hosts entries exist
grep "atom.local" /etc/hosts
# If missing:
sudo bash -c 'echo "127.0.0.1  gate.atom.local api.atom.local studio.atom.local runtime.atom.local grafana.atom.local alloy.atom.local loki.atom.local tempo.atom.local minio.atom.local minio-ui.atom.local opa.atom.local" >> /etc/hosts'
```

**atom-llm crashing (P1001 database error)**
```bash
# Prisma schema needs to be pushed
kubectl port-forward -n atom-infra svc/postgres-postgresql 5433:5432 &
SCHEMA=$(docker run --rm atom-llm:local python3 -c \
  "import litellm,os; print(os.path.join(os.path.dirname(litellm.__file__),'proxy','schema.prisma'))")
docker run --rm \
  -e DATABASE_URL="postgresql://atom:changeme@host.docker.internal:5433/atom" \
  --add-host host.docker.internal:host-gateway \
  atom-llm:local prisma db push --schema $SCHEMA --skip-generate --accept-data-loss
kubectl rollout restart deployment/atom-llm -n atom-system
```

**Postgres tables missing (users, agents, etc.)**
```bash
# Drop migration tracking and re-run all migrations
kubectl port-forward -n atom-infra svc/postgres-postgresql 5435:5432 &
sleep 2
PGPASSWORD=changeme psql -h localhost -p 5435 -U atom -d atom \
  -c "DROP TABLE IF EXISTS schema_migrations;"
migrate -database "postgresql://atom:changeme@localhost:5435/atom?sslmode=disable" \
  -path migrations up
make seed-k8s
```

**GATE returns `token_revoked`**
```bash
TOKEN=$(curl -s -X POST http://studio.atom.local:8088/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -X POST "http://studio.atom.local:8088/api/domains/<did>/agents/<aid>/regenerate-token" \
  -H "Authorization: Bearer $TOKEN"
```

**`make test` Python tests fail with ModuleNotFoundError**
```bash
# Run per-component with uv (not system python3)
uv run --project atom-studio/backend --with pytest-asyncio \
  python -m pytest atom-studio/backend/src/tests/ -q
uv run --project atom-runtime/runtime --with pytest-asyncio \
  python -m pytest atom-runtime/runtime/tests/ -q
```
