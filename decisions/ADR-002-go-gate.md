# ADR-002 — Go for GATE

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

GATE is the hot path for every request in the system. Its responsibilities are:
- JWT validation (crypto operation, every request)
- Redis lookup for rate-limit counters (network, every request)
- OPA policy evaluation (in-process or sidecar, every request)
- Hash-chain append to audit log (compute + Kafka produce, every request)
- HTTP reverse-proxy to agent pod

A wrong technology choice here becomes a performance bottleneck for the entire platform.

## Decision

Implement GATE in **Go** using the **Fiber v3** HTTP framework and **pgx v5** for Postgres.

## Rationale

- **Performance:** Go routines handle thousands of concurrent requests with sub-millisecond
  overhead per request. Fiber is the fastest Go HTTP framework in benchmarks (Fasthttp-based).
- **Binary size:** Single static binary, trivial to containerise (scratch/distroless base image).
- **Kubernetes ecosystem:** Go is the native language of k8s; client-go, controller-runtime, and
  OPA's Go SDK are all first-class.
- **OPA SDK:** `github.com/open-policy-agent/opa` provides a native Go library so OPA runs
  **in-process** — no sidecar, no network hop for policy decisions.
- **JWT:** `github.com/golang-jwt/jwt/v5` is battle-tested.
- **OTEL:** `go.opentelemetry.io/otel` is the reference implementation.

## Consequences

- **Positive:** Fast, observable, easy to containerise, OPA in-process eliminates one network hop.
- **Negative:** Team must maintain Go alongside Python (atom-llm/sdk/memory/runtime/studio).
  Mitigated by the fact that GATE is a well-scoped service (~3,000 LOC expected).

## Alternatives Considered

- **Python + FastAPI:** Already used elsewhere but would be 5–10× slower for the hot path.
- **Rust:** Faster than Go but steep learning curve for small team; ecosystem for OPA, JWT, and
  k8s clients is immature compared to Go.
- **Node.js:** Poor fit for compute-intensive JWT crypto and concurrent proxying.

---

