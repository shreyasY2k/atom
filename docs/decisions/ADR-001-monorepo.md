# ADR-001 — Monorepo Structure

**Status:** Accepted  
**Date:** 2025-01-01  
**Deciders:** Platform team

---

## Context

ATOM consists of ~8 independently deployable components (GATE, atom-llm, atom-sdk, atom-runtime,
atom-memory, atom-studio, atom-cli, policies). We need to decide whether to maintain these in a
single repository or in separate repositories.

Key constraints:
- Solo/small team (1–2 developers initially).
- Components have tight coupling at the interface level (GATE JWT schema must match what studio
  generates; OPA policy shape must match what GATE sends; CLI must match studio's API contract).
- BFSI context demands a single authoritative audit trail for all code changes.

## Decision

Use a **single Git monorepo** with subdirectories per component.

Forks of upstream projects (agentscope, LiteLLM) are vendored as subdirectories, not git
submodules. Changes from upstream are merged manually via `git subtree pull` on a per-release
cadence.

## Consequences

**Positive:**
- One PR touches all affected components atomically (e.g. a GATE API contract change updates
  both the Go server and the Python SDK client in the same commit).
- Unified CI pipeline with a single version tag for the entire platform.
- Easier onboarding: one `git clone` gives a new developer everything.
- Compliance: single repository simplifies code audit and access control.

**Negative:**
- Larger repository surface area; `git clone` is heavier.
- Build system must be component-aware (only rebuild what changed).
- Merging upstream LiteLLM/agentscope changes requires manual conflict resolution.

## Alternatives Considered

**Polyrepo:** Each component in its own repository with package references. Rejected because
interface drift between components is a real risk with a small team and no automated
contract testing framework yet. Also complicates the audit requirement.

**Git submodules:** Submodules for the fork components. Rejected because submodule UX is poor
for daily development and creates friction during upstream merges.

---

