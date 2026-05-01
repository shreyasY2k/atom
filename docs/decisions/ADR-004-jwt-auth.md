# ADR-004 — JWT + Postgres for Authentication

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

ATOM is single-tenant (one organisation). It serves two identity types:
1. **Human users** who log into atom-studio to manage agents.
2. **Agent identities** (non-human, machine-issued) that present JWTs to GATE on every request.

We must decide on an IdP.

## Decision

Build a **custom JWT authentication layer** backed by Postgres. No external IdP.

- Human users: email + bcrypt password → RS256 JWT (access token 15min, refresh token 7d).
- Agent identities: atom-studio generates a unique RS256 JWT at agent-creation time, stored in
  the `agent_tokens` table, revocable by revoking the DB record.
- GATE validates JWTs using the platform's public key (loaded from Postgres/env at startup).

## Rationale

- Single-tenant deployment: there is no multi-org SSO requirement.
- No external dependency: ATOM can operate fully air-gapped (a BFSI requirement in many
  environments).
- Simple mental model: one key pair, two token types (human / agent), one validation path in GATE.
- Refresh token rotation is sufficient for human session security at this scale.

## Upgrade Path

If an external IdP (Azure AD, Keycloak) is needed later, GATE's JWT validation middleware can
be updated to validate OIDC tokens instead. The Rego policies referencing `input.token.sub` and
`input.token.claims` remain unchanged.

## Consequences

- **Positive:** No external IdP dependency, works air-gapped, straightforward implementation.
- **Negative:** We own the security of the auth stack. Must implement secure password handling,
  refresh token rotation, and key rotation ourselves.

---

