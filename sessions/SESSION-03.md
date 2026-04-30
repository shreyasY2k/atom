# SESSION-03 — GATE Core

**Prerequisites:** SESSION-02 complete
**Goal:** Implement the GATE Go service with JWT validation, request routing, rate limiting, and hash-chained audit logging.
**Estimated time:** 2 days

---

## Architecture

```
Inbound request
  → Fiber middleware chain:
      1. RequestID (uuid per request)
      2. OTEL tracing span
      3. JWTValidateMiddleware   — validates RS256 token, loads claims
      4. RateLimitMiddleware     — Redis sliding window per token
      5. AuditLogMiddleware      — records to hash chain (async)
      6. RouteMiddleware         — extracts /domain/{id}/agent/{id}
      7. (OPA added in SESSION-04)
      8. ReverseProxyHandler     — proxies to agent pod
```

## Tasks

1. **Initialise Go module** at `gate/`
   Dependencies: `github.com/gofiber/fiber/v3`, `github.com/golang-jwt/jwt/v5`,
   `github.com/redis/go-redis/v9`, `github.com/jackc/pgx/v5`,
   `go.opentelemetry.io/otel`, `go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp`

2. **Config loading** (`gate/internal/config/config.go`)
   Load from env vars: `DATABASE_URL`, `REDIS_URL`, `JWT_PUBLIC_KEY_PATH`, `PLATFORM_HMAC_SECRET`,
   `OPA_BUNDLE_PATH`, `OTEL_EXPORTER_OTLP_ENDPOINT`.

3. **JWT validation middleware** (`gate/internal/auth/jwt.go`)
   - Load RS256 public key at startup.
   - Validate `exp`, `iss`, `sub`.
   - Extract `token_type` (`human` | `agent`), `domain_id`, `agent_id` from claims.
   - Check `agent_tokens` table for revocation (Redis cache, 60s TTL; fallback to Postgres).
   - Attach claims to `fiber.Ctx.Locals("claims")`.

4. **Rate limit middleware** (`gate/internal/ratelimit/middleware.go`)
   - Sliding window counter per `sub` (token subject) in Redis.
   - Configurable limit: default 100 req/s per agent, 10 req/s per external caller.
   - Return `429 Too Many Requests` with `Retry-After` header.

5. **Router** (`gate/internal/router/router.go`)
   - Mount all agent routes at `/domain/:domain_id/agent/:agent_id/*`.
   - Validate that path `domain_id` matches JWT claim `domain_id`.
   - Look up `cluster_service_name` from Postgres (Redis cached 60s).
   - Forward request via `httputil.ReverseProxy` (or Fiber's proxy middleware).

6. **Hash-chain audit logger** (`gate/internal/audit/chain.go`)
   - After each request (deferred), append an entry to `audit_log_chain`.
   - Also produce to Kafka topic `atom.audit` (async, non-blocking).
   - Use a goroutine pool (size 8) for async writes to avoid latency impact.
   - Compute: `prev_hash = sha256(last_entry_event)`, `hmac = hmac-sha256(secret, prev_hash||event)`.

7. **GATE health endpoints**
   - `GET /healthz` → `200 OK {status: "ok"}`
   - `GET /readyz` → checks Postgres + Redis connectivity

8. **OTEL instrumentation**
   - Trace every inbound request with span attributes: `domain_id`, `agent_id`, `token_type`.
   - Export to Alloy OTLP endpoint.

9. **Unit tests** (`gate/internal/auth/jwt_test.go`, `gate/internal/audit/chain_test.go`)
   - JWT: valid token, expired token, revoked token, wrong key.
   - Audit: hash chain integrity after N entries.

10. **Dockerfile** (`gate/Dockerfile`)
    Multi-stage build: `golang:1.22-alpine` → `gcr.io/distroless/static-debian12`.

11. **k8s Deployment manifest** (`infra/manifests/gate-deployment.yaml`)
    3 replicas, readiness/liveness probes on `/readyz` and `/healthz`, resource limits.

---

## Technologies

| Technology | Rationale |
|---|---|
| Fiber v3 | Fastest Go HTTP framework; Fasthttp-based; middleware chain model fits GATE's needs |
| golang-jwt/jwt/v5 | Standard, well-maintained RS256 JWT validation |
| go-redis/v9 | Redis client with sliding window support; connection pooling |
| pgx/v5 | Fastest Postgres driver for Go; prepared statements; pgxpool for connection pooling |
| httputil.ReverseProxy | Standard library reverse proxy; no extra dep |
| HMAC-SHA256 (crypto/hmac) | Standard library; no external dep for audit chain |

---

## Acceptance Criteria

- [ ] `gate/cmd/gate/main.go` compiles and starts.
- [ ] `GET /healthz` returns 200.
- [ ] Request with valid agent JWT returns 200; invalid JWT returns 401.
- [ ] Request with expired JWT returns 401 with `{"error":"token_expired"}`.
- [ ] Rate limit: sending 110 requests in 1s from same token → 10 get 429.
- [ ] After 5 requests, `audit_log_chain` has 5 entries; running hash validation passes.
- [ ] `go test ./...` passes in `gate/`.
- [ ] Docker image builds under 20MB.

---

## Expected Outcome

A working GATE binary that validates JWTs, rate-limits, proxies requests to agent pods, and
appends every request to the hash-chained audit log.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-03 of ATOM — the GATE Go service core.

Context:
- Module path: github.com/shreyasY2k/atom/gate
- Framework: Fiber v3 (github.com/gofiber/fiber/v3)
- Postgres client: pgx/v5 with pgxpool
- Redis client: go-redis/v9
- JWT: golang-jwt/jwt/v5 (RS256)
- OTEL: go.opentelemetry.io/otel with OTLP HTTP exporter

Implement the following files in gate/:
1. cmd/gate/main.go — entrypoint, loads config, connects to Postgres/Redis, starts Fiber
2. internal/config/config.go — env-based config struct
3. internal/auth/jwt.go — JWTValidateMiddleware, RS256, revocation check via Redis+Postgres
4. internal/ratelimit/middleware.go — sliding window rate limit via Redis ZADD/ZCOUNT
5. internal/router/router.go — mounts /domain/:domain_id/agent/:agent_id/* routes,
   validates domain_id against JWT claim, looks up cluster_service_name, proxies
6. internal/audit/chain.go — async hash chain writer:
   - Each entry: {id, seq, prev_hash, event jsonb, hmac, created_at}
   - prev_hash = sha256(previous entry's event::text)
   - hmac = hmac-sha256(PLATFORM_HMAC_SECRET, prev_hash + event_json)
   - Write to audit_log_chain table AND produce to Kafka topic atom.audit
7. internal/health/handler.go — /healthz and /readyz
8. gate/Dockerfile — multi-stage, distroless final image

Key invariants:
- JWT validation must check token revocation in agent_tokens table
- Audit writes must be async (goroutine pool of 8) and must NOT block request response
- Route proxying must pass original headers + add X-ATOM-Domain-ID and X-ATOM-Agent-ID

Write unit tests for JWT validation (valid, expired, revoked) and audit chain integrity.
```
