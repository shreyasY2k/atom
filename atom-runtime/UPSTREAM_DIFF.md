# atom-runtime — Upstream Diff

Upstream: https://github.com/modelscope/agentscope (runtime components / agentscope SDK)
Cloned on: 2026-04-28

---

## What the upstream is

`atom-runtime/` contains the **agentscope** Python SDK — a general-purpose agent framework
library. It is used *inside agent container images* (agents import `agentscope` to
build their logic). It is NOT the ATOM deployment controller.

The upstream library is left **unmodified** in `src/agentscope/`. The ATOM-specific
extensions are in `atom-sdk/` (which adds `AtomChatModel`, HITL hooks, and ATOM
embedding integration).

---

## ATOM-Specific Additions (SESSION-11)

All ATOM additions live in `runtime/` — a separate Python package **alongside** the
upstream `src/agentscope/` library. Nothing in the upstream is patched or modified.

### New package: `runtime/src/atom_runtime/`

A FastAPI microservice that acts as the **k8s deployment controller** for ATOM agents.

| File | Purpose |
|---|---|
| `config.py` | `Settings` (pydantic-settings) — DB URL, studio URL, k8s namespace, pod timeouts |
| `database.py` | asyncpg pool — shared connection pool with `get_conn()` context manager |
| `k8s_client.py` | Load kubeconfig (in-cluster or `~/.kube/config`) and return typed k8s API clients |
| `manifest_builder.py` | Build `Secret`, `Deployment`, `Service`, `NetworkPolicy` k8s objects for an agent pod |
| `deploy_webhook.py` | FastAPI app with `POST /runtime/deploy`, `POST /runtime/rollback/{id}`, `GET /healthz` |
| `main.py` | Re-exports the FastAPI app for uvicorn |

### New files

```
atom-runtime/runtime/
├── pyproject.toml          # atom-runtime package (separate from agentscope)
├── Dockerfile              # python:3.11-slim + uvicorn on port 8090
├── src/atom_runtime/       # the deployment controller package
└── tests/                  # 18 unit tests (18/18 passing)
    ├── conftest.py
    └── test_runtime.py
```

### Deployment flow implemented

```
atom-studio (HITL approved)
  → POST /runtime/deploy  {deployment_id, agent_id, domain_id, image, agent_jwt}
  ← 202 Accepted  (background task started)

Background task:
  1. Query memory_configs for resource sizing
  2. Create / replace k8s Secret  agent-jwt-{agent_id}   (ATOM_AGENT_JWT)
  3. Create / replace k8s Deployment  agent-{agent_id}   (1 replica, /healthz readiness)
  4. Create k8s Service  agent-{agent_id}:8080            (ClusterIP)
  5. Create k8s NetworkPolicy  agent-{agent_id}-ingress   (ingress from gate pods only)
  6. Poll pod readiness (configurable timeout, default 120s)
  7. UPDATE deployments SET status='deployed'|'failed'
  8. UPDATE agents SET cluster_service_name = 'agent-{id}.atom-agents.svc.cluster.local'
  9. POST atom-studio /api/runtime/deploy-result  {deployment_id, status, error}
```

### Rollback flow implemented

```
POST /runtime/rollback/{deployment_id}
  ← 202 Accepted (background task)

Background task:
  1. Find current deployment's agent_id
  2. Find previous deployment with status='deployed' for that agent
  3. Patch deployment with previous image
  4. UPDATE deployments SET status='rolled_back'
  5. POST atom-studio /api/runtime/deploy-result {status: "rolled_back"}
```

### Startup registration

On startup, atom-runtime POSTs its own URL to atom-studio:
```
POST /api/runtime/register {"url": "http://atom-runtime:8090"}
```
This allows atom-studio's `trigger_deployment` to reach atom-runtime even if the URL
changes (e.g., scaling to multiple runtime replicas behind a load balancer).

### atom-studio change (SESSION-11)

`atom-studio/backend/src/atom_studio/deployments/service.py` — `trigger_deployment`:
- Now issues a fresh RS256 agent JWT before calling atom-runtime
- Revokes the previous active token and stores the new token hash in `agent_tokens`
- Passes `agent_jwt` in the `/runtime/deploy` request body

This keeps the JWT private key in atom-studio (the authority) and gives atom-runtime
the raw JWT to store in the k8s Secret without needing access to the signing key.

---

## k8s Resources Created per Agent

| Resource | Name | Namespace |
|---|---|---|
| `Secret` | `agent-jwt-{agent_id}` | `atom-agents` |
| `Deployment` | `agent-{agent_id}` | `atom-agents` |
| `Service` | `agent-{agent_id}` | `atom-agents` |
| `NetworkPolicy` | `agent-{agent_id}-ingress` | `atom-agents` |

The agent pod's cluster DNS name: `agent-{agent_id}.atom-agents.svc.cluster.local:8080`

### NetworkPolicy

Only GATE pods (`app=gate` in `atom-system`) may reach agent pods on port 8080.
All other ingress is denied. Egress is unrestricted (agents need to call GATE, which
then proxies LLM calls — all over standard TCP).

### Pod environment variables

| Variable | Source |
|---|---|
| `ATOM_AGENT_JWT` | `Secret agent-jwt-{agent_id}` |
| `ATOM_GATE_URL` | Injected by atom-runtime (default: `http://host.docker.internal:8080` for dev kind) |
| `ATOM_AGENT_ID` | Injected directly as value |
| `ATOM_DOMAIN_ID` | Injected directly as value |

---

## Running in development

```bash
# Terminal — from atom/ root
uv run --directory atom-runtime/runtime uvicorn atom_runtime.main:app --reload --port 8090

# Tests — from atom-runtime/runtime/
cd atom-runtime/runtime
uv run pytest tests/ -v
```

The service connects to:
- Postgres at `DATABASE_URL` (same as atom-studio)
- kind cluster via `~/.kube/config`
- atom-studio at `ATOM_STUDIO_API_URL` (default `http://localhost:3001`)
