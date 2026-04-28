# ADR-013 — Agent URL Routing via GATE

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

Each deployed agent needs a stable, addressable URL for callers to send requests to.
The URL must be routable by GATE for policy enforcement and must clearly identify which
domain and agent is being addressed.

## Decision

Every agent receives a **unique URL sub-path** in the format:

```
/domain/{domain_id}/agent/{agent_id}
```

GATE receives all inbound HTTP(S) traffic and routes to the correct agent pod based on this path.
The agent pod itself runs at an internal cluster URL not exposed outside GATE.

The full call path:

```
Caller
  → https://atom.internal/domain/{did}/agent/{aid}/...
  → GATE (nginx ingress → GATE service)
    → JWT validate (token must have matching domain_id claim)
    → OPA policy check (input.path.domain_id, input.path.agent_id)
    → Proxy to http://agent-{aid}.atom-agents.svc.cluster.local/...
```

GATE reads the routing table from Postgres (`agents` table, `cluster_service_name` column)
with a Redis cache (TTL 60s) to avoid DB lookups on every request.

## Rationale

- Clear URL semantics that encode domain + agent identity.
- All traffic through one enforcement point (GATE) — satisfies the core invariant.
- Easy to audit: every log entry contains `domain_id` + `agent_id` from the URL.
- Agent pods can be updated/replaced without changing their public URL.

## Consequences

- **Positive:** Clean URL structure; GATE is the single enforcement point;
  agent pods are fully internal (zero direct exposure).
- **Negative:** GATE is a single point of failure. Mitigated by running GATE as a
  Kubernetes Deployment with multiple replicas behind the nginx ingress.

---

