# ADR-007 — agentscope Fork Strategy

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

ATOM builds on four agentscope components: the core SDK (`agentscope`), the studio UI
(`agentscope-studio`), the memory system (`agentscope-reme`), and the runtime
(`agentscope-runtime`). All are open-source (Apache 2.0).

## Decision

Fork all four into subdirectories of the ATOM monorepo as:
- `atom-sdk` (from `agentscope`)
- `atom-studio` (from `agentscope-studio`)
- `atom-memory` (from `agentscope-reme`)
- `atom-runtime` (from `agentscope-runtime`)

**Changes specific to each fork:**

`atom-sdk`:
- Remove all AI provider model wrappers (OpenAI, Anthropic, Gemini, etc.).
- Add `AtomModelWrapper` that authenticates with the agent's JWT and calls `atom-llm` via GATE.
- Add HITL hook points for HiClaw integration.

`atom-studio`:
- Add JWT auth layer (login, sessions).
- Add domain and agent management screens.
- Add agent token generation and provisioning flow.
- Add HITL decision dashboard.
- Add deployment approval workflow.
- Keep all existing agentscope-studio UI patterns and stack.

`atom-memory`:
- Add pgvector backend for long-term semantic memory.
- Add Redis backend for short-term working memory.
- Wire memory configuration from atom-studio.

`atom-runtime`:
- Integrate with ATOM Postgres for deployment configs.
- Add deployment approval webhook before k8s rollout.
- Generate per-agent Ingress rules for `/domain/{id}/agent/{id}` routing.

## Upstream Merge Policy

Upstream merges are done manually on a best-effort basis when a new upstream release contains
significant improvements. Each fork maintains a `UPSTREAM_CHANGELOG.md` noting divergence points.

## Consequences

- **Positive:** Rich existing functionality; proven agent orchestration; existing k8s deployment
  capability in agentscope-runtime.
- **Negative:** Four upstream repos to track. Merge debt accumulates over time.
  Mitigated by clear change isolation policy (ATOM changes in dedicated modules/files where possible).
