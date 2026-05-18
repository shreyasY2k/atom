package main

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"time"
)

// newBuilderGate returns an HTTP handler that:
//   - directly invokes the agent container for POST /agents/{name}/invoke
//     (GATE looks up the endpoint in platform-db and calls it directly,
//     bypassing builder-backend on the hot invocation path)
//   - transparently proxies everything else to builder-backend
//
// Uses a 10-minute response header timeout — codegen (Gemini) + Docker build
// can legitimately take 3-5 minutes end-to-end.
func newBuilderGate(cfg Config, auditor *Auditor, db *DB, logger *slog.Logger) http.Handler {
	proxy := newReverseProxy(cfg.BuilderBackendURL, 10*time.Minute)
	mux := http.NewServeMux()

	// Direct agent invocation — GATE resolves the container endpoint from
	// platform-db and calls it directly, including pre/post audit events.
	mux.Handle("POST /agents/{name}/invoke",
		DirectInvokeHandler(db, auditor, logger))

	// Swagger/OpenAPI passthrough — fetches the container's /openapi.json directly.
	// Audit-wrapped so every API doc fetch is recorded.
	mux.Handle("GET /agents/{name}/openapi.json",
		AgentPassthroughHandler(db, "/openapi.json", auditor, logger))

	// Session message posting is audit-wrapped (user input → agent output).
	mux.Handle("POST /agents/{name}/sessions/{session_id}/messages",
		AuditWrap(proxy, auditor, "builder-backend", "agent"))

	mux.HandleFunc("GET /gate/health", gateHealth("8080"))

	mux.Handle("/", proxy) // passthrough: specs, registry, deployments, auth, studio, …
	return mux
}

// newWorkflowGate returns an HTTP handler that:
// Uses a 3-minute timeout — workflow runs start async (fast), SSE streams
// are long-lived but Temporal activities keep the connection alive.
//   - audits POST /workflows/{name}/runs            (start run)
//   - audits GET  /workflows/{name}/runs/{run_id}   (poll status)
//   - audits GET  /workflows/{name}/runs/{run_id}/events (SSE stream)
//   - audits GET  /workflows/{name}/runs/{run_id}/nodes  (node events)
//   - transparently proxies everything else to workflow-backend
func newWorkflowGate(cfg Config, auditor *Auditor) http.Handler {
	proxy := newReverseProxy(cfg.WorkflowBackendURL, 3*time.Minute)
	mux := http.NewServeMux()

	mux.Handle("POST /workflows/{name}/runs",
		AuditWrap(proxy, auditor, "workflow-backend", "workflow"))
	mux.Handle("GET /workflows/{name}/runs/{run_id}",
		AuditWrap(proxy, auditor, "workflow-backend", "workflow"))
	mux.Handle("GET /workflows/{name}/runs/{run_id}/events",
		AuditWrap(proxy, auditor, "workflow-backend", "workflow"))
	mux.Handle("GET /workflows/{name}/runs/{run_id}/nodes",
		AuditWrap(proxy, auditor, "workflow-backend", "workflow"))
	mux.Handle("POST /runs/{run_id}/cancel",
		AuditWrap(proxy, auditor, "workflow-backend", "workflow"))

	mux.HandleFunc("GET /gate/health", gateHealth("8082"))

	mux.Handle("/", proxy) // passthrough: spec CRUD, task queue, audit query, …
	return mux
}

func gateHealth(port string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"service": "gate",
			"port":    port,
		})
	}
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := loadConfig()

	auditor, err := NewAuditor(cfg, logger)
	if err != nil {
		logger.Error("failed to initialise auditor", "err", err)
		os.Exit(1)
	}

	// Connect to platform-db for agent endpoint lookups.
	// A failure here is non-fatal: GATE still starts and handles all other
	// routes; agent direct-invoke returns 503 until platform-db is reachable.
	db, dbErr := NewDB(cfg.DatabaseURL)
	if dbErr != nil {
		logger.Warn("could not connect to platform-db; agent direct invoke will be unavailable",
			"err", dbErr)
		db = nil
	}

	// Create security tables in platform-db (idempotent).
	if db != nil {
		if err := db.CreateSecurityTables(); err != nil {
			logger.Warn("could not create security tables in platform-db", "err", err)
		}
	}

	builderGate := LoggingMiddleware(logger, newBuilderGate(cfg, auditor, db, logger))
	workflowGate := LoggingMiddleware(logger, newWorkflowGate(cfg, auditor))
	llmGate := LoggingMiddleware(logger, newLLMGate(cfg, auditor, db, logger))

	errCh := make(chan error, 3)

	go func() {
		logger.Info("gate/builder listening", "addr", ":8080", "backend", cfg.BuilderBackendURL)
		errCh <- http.ListenAndServe(":8080", builderGate)
	}()

	go func() {
		logger.Info("gate/workflow listening", "addr", ":8082", "backend", cfg.WorkflowBackendURL)
		errCh <- http.ListenAndServe(":8082", workflowGate)
	}()

	go func() {
		logger.Info("gate/llm listening", "addr", ":8083", "backend", cfg.LiteLLMURL)
		errCh <- http.ListenAndServe(":8083", llmGate)
	}()

	logger.Error("gate exited", "err", <-errCh)
	os.Exit(1)
}
