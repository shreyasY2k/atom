package main

// GATE — ATOM's central API gateway.
//
// Responsibilities (implemented across SESSION-03 and SESSION-04):
//   - RS256 JWT validation for every inbound request
//   - OPA Rego policy evaluation (in-process, <1ms per request)
//   - Redis-backed sliding-window rate limiting
//   - Hash-chained audit log (Postgres + Kafka)
//   - HTTP reverse-proxy to agent pods in atom-agents namespace
//   - OTEL tracing on every request
//
// Run: go run ./cmd/gate
// Build: make gate-build

func main() {
	// TODO: implement in SESSION-03
	// 1. Load config from env (internal/config)
	// 2. Connect Postgres pool (pgx/v5)
	// 3. Connect Redis client (go-redis/v9)
	// 4. Load OPA bundle (internal/policy)
	// 5. Start Fiber app with middleware chain:
	//      RequestID → OTEL → JWTValidate → RateLimit → OPAPolicy → AuditLog → Proxy
	// 6. Register /healthz and /readyz
	panic("not yet implemented — see sessions/SESSION-03.md")
}
