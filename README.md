# Mphasis Agent Platform — TechShift Demo

A two-surface platform for BFSI process automation:

- **Agent Builder** — builds audited, deployable AI agents from a versioned spec.
- **Workflow Composer** — loads existing BFSI workflows; replaces routine human-decision steps with agents; keeps humans on the calls that matter.

Stack: **Gemini-only**, **AgentScope + Temporal**, **single LiteLLM gateway**, **MinIO with object lock for audit**.

Flagship demo use case: **Asset Transfer Service (ATS)** for US bank securities operations.

## Quick start

```bash
cp .env.example .env
# set GEMINI_API_KEY
docker compose build      # ~10–15 min first time (builds AgentScope, Studio, ReMe from source)
docker compose up -d
docker compose ps         # all services healthy

open http://localhost:5173    # Mphasis Agent Platform UI (Builder + Composer)
open http://localhost:3000    # AgentScope Studio (agent traces)
open http://localhost:8233    # Temporal Web UI (workflow runs)
open http://localhost:9001    # MinIO console (audit logs)
open http://localhost:4000/ui # LiteLLM dashboard (LLM/tool calls + virtual keys)
```

## What this is

Two surfaces over a common spec → code → deploy → audit pipeline:

- A **visual agent builder** that produces a versioned `agent-spec.yaml`
- A **deterministic compiler** (Gemini 3.1 Pro + builder skill) that turns the spec into AgentScope Python
- A **visual workflow composer** that produces a versioned `workflow-spec.yaml`
- A **Temporal worker** that executes workflows: agent nodes, HTTP nodes, decision nodes, human task nodes
- **LiteLLM** as the single gateway with **per-agent virtual keys** = non-human identities
- **MinIO** with object lock for audit
- **Mock BFSI services** (treasury, market data, LCR engine, OCR, FNOL/policy, KYC, OFAC, SWIFT, internal task queue)

## Three build modes

| Mode | Description |
|---|---|
| **A. Visual + AI** | UI generates from prose. Fastest. Used for demo path 1. |
| **B. CLI scaffold + manual** | `mphasis agent scaffold <name>` and `mphasis workflow init` produce stubs in repo; developer fills in. Used for demo path 2 (the realistic dev workflow). |
| **C. Full natural-language** | UI generates entire workflow including its agents from prose. Optional demo wow. |

## What this is not

A production-grade product. It's a TechShift capability demo intended to land follow-up engagements with US bank prospects.

## See also

- [`CLAUDE.md`](./CLAUDE.md) — context for AI coding assistants
- [`docs/architecture.md`](./docs/architecture.md) — system design
- [`docs/identity-and-audit.md`](./docs/identity-and-audit.md) — non-human identity model
- [`docs/workflow-spec-format.md`](./docs/workflow-spec-format.md) — workflow YAML schema
- [`docs/tasks/00-overview.md`](./docs/tasks/00-overview.md) — work plan
