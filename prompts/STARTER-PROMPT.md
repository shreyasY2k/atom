# ATOM — Master Starter Prompt for Claude Code

> Paste this into a fresh Claude Code session before starting any implementation session.
> It gives Claude Code the full architectural context so all decisions are consistent.

---

## Platform Overview

You are helping build **ATOM** — a secure, single-tenant, BFSI-grade agentic development and
deployment framework. The primary design constraint is: **no agent ever interacts with the
outside world directly — every request flows through GATE**, where it is authenticated,
policy-checked, rate-limited, and appended to an immutable audit chain.

---

## Key Decisions (non-negotiable — do not suggest alternatives)

| Decision | Chosen Technology | Rationale |
|---|---|---|
| Gateway | Go + Fiber v3 | Performance, OPA in-process |
| Policy engine | OPA + Rego | Policy-as-code, hot-reload |
| LLM gateway | LiteLLM OSS fork | 100+ providers, virtual keys |
| Agent SDK | agentscope fork | Mature multi-agent framework |
| Studio frontend | agentscope-studio existing stack | No rebuild |
| Auth | Custom JWT + Postgres | No external IdP, air-gap capable |
| Audit log | Hash-chained Postgres table | Tamper-evident BFSI requirement |
| Local k8s | kind | Lightweight, reproducible |
| Vector DB | pgvector (Postgres extension) | Avoids extra service |
| Object storage | MinIO | S3-compatible, self-hosted |
| Log streaming | Kafka (Redpanda) | Replay, BFSI archival |
| Monitoring | OTEL + Grafana Alloy + Tempo | Full trace/metric pipeline |
| Tenancy | Single-tenant | One org, one installation |
| Team | Solo / 1-2 devs | Keep scope tight |

---

## Repository Structure

```
atom/
├── gate/                    Go — GATE service (auth, policy, routing, audit)
├── atom-llm/                Python — forked LiteLLM
├── atom-sdk/                Python — forked agentscope
├── atom-runtime/            Python — forked agentscope-runtime
├── atom-memory/             Python — forked agentscope-reme
├── atom-studio/             Existing stack — forked agentscope-studio (UI + FastAPI)
├── atom-cli/                Go — Cobra CLI
├── policies/                OPA Rego (base/ + custom/ + tests/)
├── infra/                   Helm values, kind config, k8s manifests
├── migrations/              golang-migrate SQL files
├── decisions/               Architecture Decision Records
├── sessions/                Implementation session files
└── tests/                   E2E and load tests
```

---

## Core Invariants

1. Every inbound request → GATE. No exceptions.
2. GATE audit chain entry per request: `{prev_hash, event, hmac(secret, prev_hash||event)}`.
3. Every agent has a non-human RS256 JWT identity issued by atom-studio.
4. All LLM calls: agent → GATE → atom-llm (Kubernetes NetworkPolicy enforces this).
5. All deployments approval-gated via HITL in atom-studio.
6. Policy is code — Rego rules in `policies/`, versioned, hot-reloaded.

---

## Database Schema (14 tables)

`users`, `domains`, `agents`, `agent_tokens`, `policies`, `agent_policies`,
`tools`, `agent_tools`, `skills`, `agent_skills`, `memory_configs`,
`audit_log_chain` (seq bigserial + hmac), `deployments`, `hitl_workflows`,
`memory_vectors` (pgvector vector(1536), HNSW index)

---

## URL Routing Convention

```
/domain/{domain_id}/agent/{agent_id}/*    ← GATE proxies to agent pod
```

GATE reads `agents.cluster_service_name` from Postgres (Redis cached, TTL 60s) to resolve
the internal k8s service URL.

---

## JWT Schema

Human JWT:
```json
{ "sub": "user-{uuid}", "type": "human", "role": "admin|developer",
  "iat": ..., "exp": ..., "iss": "atom-studio" }
```

Agent JWT:
```json
{ "sub": "agent-{uuid}", "type": "agent", "domain_id": "{uuid}", "agent_id": "{uuid}",
  "iat": ..., "iss": "atom-studio" }
```

Algorithm: RS256. Private key held by atom-studio; public key loaded by GATE at startup.

---

## Audit Chain Entry

```json
{
  "id": "uuid",
  "seq": 42,
  "prev_hash": "sha256 of previous entry's event JSON (hex)",
  "event": {
    "timestamp": "2025-01-01T12:00:00Z",
    "domain_id": "...", "agent_id": "...",
    "caller_token_hash": "sha256 of inbound JWT",
    "method": "POST", "path": "/domain/.../agent/.../...",
    "policy_decision": { "allow": true, "reason": "" },
    "status_code": 200, "latency_ms": 12
  },
  "hmac": "hmac-sha256(PLATFORM_HMAC_SECRET, prev_hash + event_json)"
}
```

---

## HITL Flow

```
Agent code calls hitl.request(payload, timeout_s=300)
  → atom-sdk creates hitl_workflows record via POST /api/hitl/request
  → atom-studio pushes to HITL queue (WebSocket)
  → Human reviewer approves/rejects in studio
  → hitl_workflows record updated
  → atom-sdk polls until decision or timeout
  → agent continues or raises TimeoutError
```

Deployment approvals use the same mechanism (`workflow_type = 'DEPLOYMENT_APPROVAL'`).

---

## Environment Variables

```bash
# GATE
DATABASE_URL=postgresql://atom:pass@postgres.atom-infra.svc/atom
REDIS_URL=redis://:pass@redis.atom-infra.svc:6379
JWT_PUBLIC_KEY_PATH=/etc/atom/jwt_public.pem
PLATFORM_HMAC_SECRET=<32-byte-hex>
OPA_BUNDLE_PATH=/etc/atom/policies
KAFKA_BROKERS=redpanda.atom-infra.svc:9092
OTEL_EXPORTER_OTLP_ENDPOINT=http://alloy.atom-system.svc:4318

# atom-studio
DATABASE_URL=...
JWT_PRIVATE_KEY_PATH=/etc/atom/jwt_private.pem
JWT_PUBLIC_KEY_PATH=/etc/atom/jwt_public.pem
ATOM_ENCRYPTION_KEY=<32-byte-AES-key>
ATOM_LLM_URL=http://atom-llm.atom-system.svc:4000

# atom-llm
DATABASE_URL=...
KAFKA_BROKERS=...
MINIO_ENDPOINT=http://minio.atom-infra.svc:9000
MINIO_ACCESS_KEY=...
MINIO_SECRET_KEY=...

# Agent pod (injected by atom-runtime)
ATOM_AGENT_JWT=<agent-jwt>
ATOM_GATE_URL=http://gate.atom-system.svc
ATOM_AGENT_ID=<uuid>
ATOM_DOMAIN_ID=<uuid>
```

---

## Session Reference

Start each Claude Code session by loading the relevant session file from `sessions/`.
Sessions must be completed in order (each builds on the previous).

| File | Contents |
|---|---|
| `sessions/SESSION-00.md` | Monorepo setup |
| `sessions/SESSION-01.md` | Infrastructure on kind |
| `sessions/SESSION-02.md` | Database schema |
| `sessions/SESSION-03.md` | GATE core (JWT, routing, audit) |
| `sessions/SESSION-04.md` | GATE + OPA integration |
| `sessions/SESSION-05.md` | atom-llm (LiteLLM fork) |
| `sessions/SESSION-06.md` | atom-sdk (agentscope fork) |
| `sessions/SESSION-07.md` | atom-studio auth + domains |
| `sessions/SESSION-08.md` | atom-studio agent provisioning |
| `sessions/SESSION-09.md` | atom-studio HITL + deployment approval |
| `sessions/SESSION-10.md` | atom-cli |
| `sessions/SESSION-11.md` | atom-runtime (k8s deployment) |
| `sessions/SESSION-12.md` | atom-memory (pgvector + Redis) |
| `sessions/SESSION-13.md` | Monitoring (OTEL + Grafana stack) |
| `sessions/SESSION-14.md` | Kafka logging pipeline |
| `sessions/SESSION-15.md` | E2E testing + hardening |

---

## How to Start a Session

1. Open Claude Code in your `atom/` directory.
2. Paste this entire file as your first message.
3. Add: "Now load `sessions/SESSION-XX.md` and begin."
4. Claude Code will read the session file and execute the tasks in order.
5. After completing, confirm each acceptance criterion before marking the session done.

---

## Coding Standards

- **Go**: `gofmt`, `golangci-lint` with `errcheck`, `staticcheck`, `gosec`. Error wrapping
  with `fmt.Errorf("...: %w", err)`. No naked panics in production paths.
- **Python**: `ruff` linter, `black` formatter, type hints on all public functions, `pytest`.
- **Rego**: `opa fmt`, `opa check`, unit tests in `policies/tests/`.
- **SQL migrations**: reversible (every `.up.sql` has a matching `.down.sql`).
- **k8s manifests**: always set `resources.limits`, `securityContext.runAsNonRoot`,
  `readinessProbe`, `livenessProbe`.
- **Commits**: Conventional Commits format (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).

---

## Security Non-Negotiables

- Secrets in k8s Secrets, never in ConfigMaps or source code.
- All containers run as non-root with `readOnlyRootFilesystem: true`.
- NetworkPolicies enforced: only GATE reaches atom-llm; only atom-runtime reaches k8s API.
- JWT private key never leaves atom-studio pod.
- HMAC secret for audit chain rotatable without data loss (documented in RUNBOOK.md).
