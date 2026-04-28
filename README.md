# ATOM — Agentic Transformation & Operations Manager

> A secure, auditable, BFSI-grade framework for developing, governing, and deploying AI agents.

---

## What ATOM Is

ATOM is a **single-tenant, on-premises agentic platform** built for financial services organisations.
It enforces the principle that **no agent ever touches the outside world directly** — every call flows
through GATE, where it is authenticated, policy-checked, rate-limited, and appended to an
immutable audit chain.

---

## Repository Layout

```
atom/                          ← monorepo root
├── gate/                      ← Go service: auth, policy, routing, audit
├── atom-llm/                  ← Forked LiteLLM: LLM gateway + tool/skill config
├── atom-sdk/                  ← Forked agentscope: Python SDK for agent developers
├── atom-runtime/              ← Forked agentscope-runtime: k8s agent deployment
├── atom-memory/               ← Forked agentscope-reme: pgvector + Redis memory
├── atom-studio/               ← Forked agentscope-studio: management UI + API
├── atom-cli/                  ← Go CLI: atom create / validate / deploy agent
├── policies/                  ← OPA Rego policies (source of truth)
│   ├── base/                  ← Core policies shipped with ATOM
│   └── custom/                ← Org-specific policy overrides
├── infra/                     ← Kubernetes manifests, Helm values, kind config
│   ├── kind/                  ← kind cluster config
│   ├── helm/                  ← Helm chart values per component
│   └── manifests/             ← Raw k8s manifests
├── migrations/                ← golang-migrate SQL files
├── decisions/                 ← Architecture Decision Records (ADR-001 … ADR-014)
├── sessions/                  ← Claude Code implementation session files (SESSION-00.md … SESSION-15.md)
├── docs/                      ← Developer guide and reference docs
├── ARCHITECTURE.md            ← System architecture + all flow diagrams (Mermaid)
├── RUNBOOK.md                 ← Operational procedures (key rotation, scaling, chain validation, …)
├── prompts/                   ← Starter prompts for each session
├── Makefile                   ← Root make targets
└── docker-compose.dev.yml     ← Local dev (non-k8s) fast iteration
```

---

## Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Gateway | Go + Fiber v3 | Performance, small binary, k8s native |
| Policy engine | OPA + Rego | Policy-as-code, hot reload, BFSI compliance ready |
| LLM gateway | LiteLLM OSS (forked) | 100+ provider support, virtual key management |
| Agent SDK | agentscope (forked) | Mature multi-agent framework |
| Studio UI | agentscope-studio (forked) | Existing stack preserved |
| Agent runtime | agentscope-runtime (forked) | k8s-native agent deployment |
| Memory | agentscope-reme (forked) + pgvector + Redis | Long-term (vector) + short-term (cache) |
| Auth | JWT + Postgres (custom) | No external IdP dependency, full control |
| Primary DB | PostgreSQL 16 | Config, schema, audit metadata |
| Vector DB | pgvector (Postgres extension) | Co-located, avoids separate vector store |
| Cache / rate-limit | Redis 7 | Sub-millisecond token lookups, rate counters |
| Object storage | MinIO | S3-compatible, self-hosted, data sovereignty |
| Log streaming | Kafka (Redpanda) | High throughput, replay, BFSI audit trail |
| Observability | OTEL + Grafana Alloy + Tempo + Grafana | Full trace/metric/log pipeline |
| Local k8s | kind (Kubernetes in Docker) | Lightweight, reproducible dev cluster |
| CLI | Go + Cobra | Single static binary for developers |

---

## Personas

| Persona | What they do |
|---|---|
| **Platform admin** | Deploys ATOM, manages OPA policies, monitors system health |
| **Domain developer** | Uses atom-studio to create domains and agents, uses atom-cli to build and deploy |
| **Agent** (non-human identity) | Sends/receives requests through GATE with its unique JWT; owned by a human user |
| **External caller** | Bank system, fintech service, or another internal agent calling an ATOM agent endpoint |

---

## Core Invariants

1. **Every request goes through GATE.** No agent exposes a direct endpoint outside GATE.
2. **Every GATE request is logged.** Log entries form a hash chain `{prev_hash, event, hmac(secret, prev_hash||event)}`.
3. **Every agent has a non-human JWT identity.** Issued at creation time in atom-studio; revocable.
4. **All LLM calls are GATE-mediated.** Agents call atom-llm through GATE, never directly.
5. **All deployments are approval-gated.** `atom deploy` submits to studio; an approver must accept before k8s rollout.
6. **Policy is code.** OPA Rego rules in `policies/` are versioned, tested, and hot-reloaded without restart.

---

## Quick Start

```bash
# 1. Clone this repo
git clone https://github.com/your-org/atom.git && cd atom

# 2. Clone the five upstream forks into the monorepo (SESSION-00)
#    atom-llm (LiteLLM), atom-sdk, atom-studio, atom-runtime, atom-memory (agentscope)
bash scripts/clone-upstreams.sh

# 3. Install required tools
make bootstrap

# 4. Set up secrets
cp .env.example .env
make generate-keys       # generates RSA-4096 JWT key pair in .keys/
# Edit .env — set key paths and any real LLM API keys

# 5. Spin up kind cluster + infrastructure
make infra-up

# 6. Apply database schema (after SESSION-02 creates migration files)
make migrate-up

# 7. Start local dev stack (docker-compose — faster iteration than k8s)
make dev-up

# 8. Open atom-studio
open http://localhost:3000

# 9. Install atom-cli
make cli-install

# 10. Create your first agent
atom login --studio http://localhost:3000
atom create agent <token-from-studio>
atom validate
atom deploy
```

---

## Implementation Sessions

Work through these in order. Each file in `sessions/` contains tasks, acceptance criteria, and a
ready-to-paste Claude Code starter prompt.

| # | Session | Est. days |
|---|---|---|
| 00 | Monorepo setup | 0.5 |
| 01 | Infrastructure on kind | 1 |
| 02 | Database schema | 0.5 |
| 03 | GATE core (JWT, routing, audit) | 2 |
| 04 | GATE + OPA integration | 1.5 |
| 05 | atom-llm (LiteLLM fork) | 1.5 |
| 06 | atom-sdk (agentscope fork) | 1 |
| 07 | atom-studio auth + domains | 1.5 |
| 08 | atom-studio agent provisioning | 2 |
| 09 | atom-studio HITL + deployment approval | 1.5 |
| 10 | atom-cli | 1.5 |
| 11 | atom-runtime (k8s deployment) | 1.5 |
| 12 | atom-memory (pgvector + Redis) | 1 |
| 13 | Monitoring (OTEL + Grafana stack) | 1 |
| 14 | Kafka logging pipeline | 1 |
| 15 | E2E testing + hardening | 1.5 |

**Total estimate: ~21 developer-days** (solo dev; pair dev reduces this by ~30%)

---

## Architecture Decisions

All major decisions are documented in `decisions/`. Start with ADR-001 for monorepo rationale.
