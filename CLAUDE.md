# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo Layout

Seven services across two languages:

| Service | Lang | Port | Role |
|---|---|---|---|
| `gate/` | Go | 8080 | Auth gateway — JWT validation, OPA policy, rate limiting, Kafka audit, reverse proxy to all backends |
| `atom-llm/` | Python | 4000 | LiteLLM fork — GATE-authenticated LLM proxy; virtual key per agent, domain = team |
| `atom-studio/` | Python + TS | 3001 / 5173 | Platform UI — agent CRUD, HITL queue, deployments, audit page, live logs |
| `atom-runtime/` | Python | 8090 | K8s controller — builds K8s manifests, deploys/rollbacks agent pods, injects env vars |
| `atom-memory/` | Python | — | Memory library — pgvector (long-term semantic) + Redis (short-term KV), used as a package |
| `atom-sdk/` | Python | — | AgentScope fork — AtomChatModel, Toolkit, HITL hooks, MCP support; shipped inside agent containers |
| `atom-cli/` | Go | — | CLI — `atom login / create / deploy / logs` |

**Go workspace:** `go.work` at root covers `gate/` and `atom-cli/`. Sync with `make go-sync`.

**Python:** Each Python service has its own `pyproject.toml` + `uv.lock`. No unified uv workspace yet — `cd` into the service dir and run `uv` commands there.

## Common Commands

All top-level targets are in the root `Makefile`.

### Local dev stack
```bash
cp .env.example .env                  # fill in secrets once
make generate-keys                    # creates .keys/jwt_private.pem + jwt_public.pem
make dev-up                           # docker compose up --build -d (all services)
make migrate-dev                      # apply all DB migrations against docker postgres
make seed-dev                         # load seed_dev.sql (admin@atom.local / admin123)
make dev-down                         # tear down
```

### Running tests
```bash
make test-go                          # go test ./... -race -count=1 (gate + cli)
make test-python                      # pytest for all Python services
make test-e2e                         # pytest tests/e2e/ (needs live k8s cluster)
make test-load                        # k6 load test → tests/load/results/summary.json

# Single service
cd gate && go test ./... -run TestName -v
cd atom-runtime/runtime && uv run pytest tests/test_manifest_builder.py -v
cd atom-studio/backend && uv run pytest src/tests/ -v
cd atom-memory/memory && uv run pytest tests/ -v
```

### Building
```bash
make build-go                         # compiles gate + atom-cli binaries to bin/
make build-images                     # docker build for all services

# Single image
docker build -f gate/Dockerfile -t gate:dev gate/
docker build -f atom-studio/backend/Dockerfile -t atom-studio-api:dev atom-studio/backend/
```

### Kubernetes (kind for local)
```bash
make infra-up                         # helm install Postgres/Redis/MinIO/Redpanda/OPA/nginx
make k8s-deploy                       # apply all app manifests
make monitoring-up                    # Grafana + Loki + Tempo + Alloy
make migrate-up                       # run migrations against k8s postgres
make kind-load IMG=gate:dev           # load image into kind cluster
make k8s-rollout-restart SVC=gate     # rolling restart of a deployment
```

### DB migrations (golang-migrate)
```bash
make migrate-dev                      # up (docker postgres)
make migrate-up                       # up (k8s postgres)
make migrate-down 1                   # rollback one step
make migrate-status                   # show current version
```
Migration files live in `migrations/` as `NNNNNN_name.up.sql` / `.down.sql`.

### Linting
```bash
cd gate && go vet ./...
cd atom-llm && uv run ruff check . && uv run mypy litellm/
cd atom-studio/backend && uv run ruff check src/
cd atom-studio/frontend && npm run lint
```

## Architecture: Request Flow

```
Agent code  →  GATE :8080
               ├── validates RS256 JWT (ATOM_AGENT_JWT, injected by atom-runtime)
               ├── checks OPA policy (policies/base/)
               ├── writes to Kafka topic atom.audit
               └── proxies to:
                   ├── /v1/*        → atom-llm :4000  (LLM calls)
                   ├── /hitl/*      → atom-studio :3001
                   └── /memory/*    → atom-memory :8000
```

Every **agent** is a LiteLLM virtual key inside atom-llm. Every **domain** is a LiteLLM team. This means budget limits, model restrictions, and usage tracking all live in atom-llm and are scoped at both levels.

## Architecture: Agent Deployment Flow

```
atom-cli `atom deploy`
  → POST /api/deployments/{agent_id}  (atom-studio)
      → triggers atom-runtime :8090
          → builds K8s Pod manifest (manifest_builder.py)
          → injects env vars: ATOM_AGENT_JWT, ATOM_GATE_URL, ATOM_AGENT_ID, ATOM_DOMAIN_ID
          → kubectl apply (or Docker run in dev)
```

atom-runtime is the only service that talks to the K8s API. It reads `KUBECONFIG` or in-cluster service account.

## Architecture: Memory

`atom-memory` is a library, not a running service. Agents import it directly:

```python
from atom_memory import MemoryManager
mem = MemoryManager.from_config(agent_id=..., db_pool=..., redis=..., embedding_model=...)
# long-term: await mem.remember(...) / recall(...) — pgvector cosine search
# short-term: await mem.set(...) / get(...) — Redis KV with TTL
```

`AtomChatModel` in atom-sdk accepts an optional `memory_manager=` kwarg and auto-injects top-5 recalled memories into the system prompt before every LLM call. Memory failures are silently swallowed — they never block LLM calls.

## Architecture: Skills and Tools (current state)

**Agent Skills** (atom-sdk `Toolkit.register_agent_skill(dir)`) are local-filesystem knowledge bundles (a directory with `SKILL.md` + supporting files). They are injected into the agent system prompt via `toolkit.get_agent_skill_prompt()`. No automatic runtime loading — they must be baked into the agent's Docker image.

**Platform registry** (`skills` + `agent_skills` tables, Studio `/skills/` API) stores skill metadata including an optional `pip_package` field, but as of SESSION-15 this registry is **not yet wired to the runtime** — the deployment pipeline does not read it or pass it to agent pods.

## Key Environment Variables

| Variable | Set by | Consumed by |
|---|---|---|
| `DATABASE_URL` | `.env` / k8s Secret | All Python services, GATE |
| `REDIS_URL` | `.env` / k8s Secret | GATE, atom-studio, atom-memory |
| `KAFKA_BROKERS` | `.env` / k8s ConfigMap | GATE, atom-llm, atom-studio, log-archiver |
| `JWT_PRIVATE_KEY_PATH` / `JWT_PUBLIC_KEY_PATH` | `.env` | GATE (sign/verify) |
| `LITELLM_MASTER_KEY` | `.env` | atom-llm (admin key for virtual key mgmt) |
| `ATOM_GATE_URL` | atom-runtime (injected) | Agent pods → AtomChatModel |
| `ATOM_AGENT_JWT` | atom-runtime (injected) | Agent pods → GATE auth |
| `ATOM_AGENT_ID` / `ATOM_DOMAIN_ID` | atom-runtime (injected) | Agent pods → memory scoping |
| `OPA_URL` | `.env` | GATE policy checks |

## Kafka Topics

| Topic | Producer | Consumer |
|---|---|---|
| `atom.audit` | GATE (every request) | log-archiver, Studio audit page |
| `atom.llm` | atom-llm (every LLM call) | log-archiver |
| `atom.agent.logs` | Agent containers | log-archiver, Studio live logs WS |
| `atom.deployments` | atom-studio | log-archiver |

## OPA Policy

Policies live in `policies/base/`. GATE hot-reloads them — no restart needed. The OPA bundle endpoint is `GET /bundle.tar.gz` served by GATE itself. Policy decisions gate every proxied request by agent ID, domain ID, and route.

## Database Schema

Migrations in `migrations/` numbered `000001`–`000011`. Key tables:
- `domains`, `agents` — platform entities; agent has `domain_id` FK
- `virtual_keys` — maps agent → LiteLLM virtual key ID
- `skills`, `agent_skills` — skill catalog + agent-skill join table
- `tools`, `agent_tools` — tool catalog + agent-tool join table
- `memory_vectors` — pgvector table (`embedding vector(1536)`, HNSW index)
- `deployments` — deployment history per agent
- `hitl_requests` / `hitl_decisions` — human-in-the-loop queue
- `audit_logs` — GATE audit trail (also in Kafka)

## LiteLLM Fork Notes

`atom-llm/` is a fork of LiteLLM 1.83.14. ATOM-specific extensions live in `atom-llm/atom_extensions/` — do not modify upstream LiteLLM files unless necessary. The fork tracks upstream via `git remote add upstream`. The `config.dev.yaml` drives model routing; `litellm/proxy/schema.prisma` owns the LiteLLM DB schema (separate from ATOM's migrations).

## atom-sdk Fork Notes

`atom-sdk/` is a fork of AgentScope. ATOM additions: `AtomChatModel` (`model/_atom_model.py`), HITL hooks, and `_toolkit.py` extensions. The SDK is bundled into agent container images by `atom-cli` (copied to `.atom-sdk/` at build time).
