# ADR-006 — Fork Open-Source LiteLLM

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

ATOM needs an LLM gateway that can:
- Route requests to multiple LLM providers (OpenAI, Azure OpenAI, Anthropic, self-hosted).
- Manage per-agent virtual API keys (agent A can only use model X).
- Track usage per agent for billing/monitoring.
- Register tools and skills that agents can invoke.
- Store audit logs to object storage.
- Be completely internal (no external egress except to configured LLM endpoints).

## Decision

Fork **open-source LiteLLM** (`BerriAI/litellm`) as `atom-llm`.

Modifications made to the fork:
1. Remove the LiteLLM SaaS telemetry and phone-home calls.
2. Add `atom_agent_id` as a first-class metadata field on every request.
3. Implement an `/atom/tools` and `/atom/skills` registration API.
4. Configure Kafka as an additional audit log sink alongside the existing S3/MinIO sink.
5. Enforce that all traffic routing to atom-llm comes via GATE (network policy in k8s).

## Rationale

- LiteLLM already supports 100+ providers with a unified `/chat/completions` interface.
- Its virtual key system maps naturally to per-agent keys.
- Its existing audit log to S3 satisfies MinIO/BFSI storage requirement.
- Starting from scratch would take months for equivalent provider coverage.
- The OSS license (MIT) permits forking and modification.

## Merge Strategy

Upstream LiteLLM releases are merged into `atom-llm` on a quarterly cadence. A `UPSTREAM_DIFF.md`
file in `atom-llm/` documents all ATOM-specific changes to simplify merge conflict resolution.

## Consequences

- **Positive:** Months of engineering saved. Proven provider integrations inherited.
- **Negative:** Upstream merge conflicts will occur. ATOM-specific changes must be carefully
  isolated to minimise merge surface.

---

