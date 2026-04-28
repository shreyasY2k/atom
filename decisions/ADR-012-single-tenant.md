# ADR-012 — Single-Tenant Architecture

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

ATOM is designed for a single BFSI organisation to deploy and operate internally. The question
is whether to design for multi-tenancy (multiple banks/fintechs sharing one installation) or
single-tenancy (one organisation, one installation).

## Decision

**Single-tenant.** One organisation owns and operates one ATOM installation.

"Domains" within ATOM are **logical groupings** of agents within that one organisation (e.g.
"retail banking domain", "fraud detection domain"), not tenant isolation boundaries.

## Rationale

- BFSI organisations strongly prefer not to share infrastructure with other organisations.
- Single-tenant simplifies the security model dramatically: no tenant isolation in Postgres,
  no cross-tenant data leakage risk, no tenant-scoped rate limiting complexity.
- The Rego policy model, JWT schema, and database schema are all simpler without tenant IDs.
- If multi-tenancy is ever needed, it should be implemented as multiple independent ATOM
  installations (one per org), not by adding tenant isolation to a shared installation.

## Consequences

- **Positive:** Simpler security model, simpler code, meets BFSI deployment norms.
- **Negative:** Cannot be offered as a SaaS platform to multiple orgs from one instance.
  This is an explicit non-goal.

---

