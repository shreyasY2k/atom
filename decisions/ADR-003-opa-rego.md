# ADR-003 — OPA + Rego for Policy Engine

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

ATOM is targeted at BFSI organisations that require auditable, versioned, testable access control
policies covering: agent identity, domain isolation, tool/skill access, inter-agent communication,
rate limits, and eventually PCI-DSS / SOC 2 guardrails.

We need a policy engine that:
- Can be updated without redeploying GATE.
- Has a human-readable policy language.
- Is testable with unit tests.
- Can produce structured policy decision logs.

## Decision

Use **Open Policy Agent (OPA)** embedded in GATE via the Go SDK, with policies written in
**Rego** and stored in `policies/` in the monorepo.

Policies are compiled into a bundle (`rego bundle build`) and hot-reloaded by GATE via OPA's
bundle API. No OPA server sidecar is needed in production.

## Rationale

- OPA is the CNCF graduated standard for policy-as-code and is widely accepted in BFSI/fintech.
- Rego is declarative, readable, and testable with `opa test`.
- The Go SDK allows OPA to run in-process inside GATE, eliminating a network call per request.
- Policy bundles can be signed (HMAC or ECDSA) satisfying compliance requirements for
  policy integrity.
- Existing BFSI compliance templates (PCI, SOC 2) exist in the OPA community.

## Consequences

- **Positive:** Policies are code, versioned in git, reviewed in PRs, tested in CI.
  BFSI compliance policy can be layered on without touching GATE's Go code.
- **Negative:** Rego has a learning curve. Must invest in Rego training.
  Policy bundle compilation added to CI pipeline.

## Alternatives Considered

- **Casbin (in-process Go):** Simpler but not expressive enough for complex BFSI policies.
  No bundle/hot-reload mechanism.
- **Custom Go rule engine:** Full control but reinvents the wheel; no community, no compliance
  templates.
- **Cedar (AWS):** Strong model for ABAC but immature Go SDK; smaller ecosystem.

---

