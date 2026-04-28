# ADR-005 — Hash-Chained Audit Log

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

BFSI organisations require a tamper-evident audit trail proving that logs have not been modified
after the fact. GATE processes every request and is the natural point to produce this trail.

## Decision

Every GATE request appends an entry to the `audit_log_chain` table with the structure:

```
{
  id:         uuid (PK)
  prev_hash:  sha256 of previous entry (hex)
  event:      json blob (timestamp, domain_id, agent_id, caller_token_hash, method, path,
               policy_decision, status_code)
  hmac:       hmac-sha256(platform_secret, prev_hash || event_json)
  created_at: timestamptz
}
```

The chain is validated by:
1. Walking entries in insertion order.
2. Recomputing `hmac(secret, prev_hash || event)` and comparing to stored HMAC.
3. Verifying each `prev_hash` equals `sha256(event_{n-1})`.

This happens in a background validator job, and in the studio's audit dashboard.

Simultaneously, the same event is produced to a Kafka topic for real-time consumers.

## Rationale

- Hash chaining is a well-understood tamper-evident structure (used in blockchains, certificate
  transparency logs, WORM storage).
- Stays entirely within Postgres — no additional infrastructure for the audit chain itself.
- The HMAC with a platform secret prevents external modification of the chain without access to
  the secret.

## Consequences

- **Positive:** Tamper-evident, inspectable in SQL, satisfies BFSI audit trail requirements.
- **Negative:** Slight write amplification on GATE (one extra INSERT per request).
  High-throughput deployments may need to batch-write audit entries asynchronously.
  Initial implementation writes synchronously; async batching is a follow-up ADR when needed.

## Alternatives Considered

- **Append-only Postgres table (no hash chain):** Simpler but not tamper-evident.
  An attacker with DB write access can modify entries.
- **External WORM storage (S3 Object Lock):** Excellent long-term tamper evidence but adds
  MinIO dependency to the hot path. Adopted as a secondary archive (via Kafka → MinIO) but
  not as the primary real-time chain.
- **Blockchain:** Overkill; adds significant operational complexity with no additional
  security over a keyed hash chain for a single-tenant system.

---

