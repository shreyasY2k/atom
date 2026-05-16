package main

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// DirectInvokeHandler returns an http.Handler that:
//  1. Looks up the agent container endpoint from platform-db by agent name
//  2. POSTs the request body directly to {endpoint}/invoke (bypassing builder-backend)
//  3. Streams the response back to the caller
//  4. Wraps the call with pre/post GateAuditEvents written to MinIO
//
// If db is nil (platform-db unreachable at startup), every request returns 503.
func DirectInvokeHandler(db *DB, auditor *Auditor, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		id := extractIdentity(r)
		gateRunID := newGateRunID()
		start := time.Now()

		// Propagate gate run ID to caller.
		w.Header().Set("X-Gate-Run-Id", gateRunID)
		r.Header.Set("X-Gate-Run-Id", gateRunID)

		pre := GateAuditEvent{
			GateRunID:  gateRunID,
			Timestamp:  start.UTC().Format(time.RFC3339Nano),
			ActorID:    id.ActorID,
			ActorType:  id.ActorType,
			TargetType: "agent",
			TargetName: name,
			Method:     r.Method,
			Path:       r.URL.Path,
			Backend:    "agent-container",
			Phase:      "pre",
		}
		auditor.Write(pre)

		// Fail fast if platform-db is unavailable.
		if db == nil {
			http.Error(w, "platform-db unavailable; agent direct invoke is offline", http.StatusServiceUnavailable)
			post := pre
			post.Phase = "post"
			post.StatusCode = http.StatusServiceUnavailable
			post.DurationMS = time.Since(start).Milliseconds()
			post.Error = "db is nil"
			auditor.Write(post)
			return
		}

		endpoint, err := db.GetAgentEndpoint(name)
		if err != nil {
			logger.Warn("agent endpoint lookup failed", "name", name, "err", err)
			http.Error(w, fmt.Sprintf("agent %q not found or not deployed", name), http.StatusNotFound)
			post := pre
			post.Phase = "post"
			post.StatusCode = http.StatusNotFound
			post.DurationMS = time.Since(start).Milliseconds()
			post.Error = err.Error()
			auditor.Write(post)
			return
		}

		targetURL := strings.TrimRight(endpoint, "/") + "/invoke"
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			post := pre
			post.Phase = "post"
			post.StatusCode = http.StatusBadRequest
			post.DurationMS = time.Since(start).Milliseconds()
			post.Error = err.Error()
			auditor.Write(post)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, targetURL,
			strings.NewReader(string(body)))
		if err != nil {
			http.Error(w, "internal error building upstream request", http.StatusInternalServerError)
			post := pre
			post.Phase = "post"
			post.StatusCode = http.StatusInternalServerError
			post.DurationMS = time.Since(start).Milliseconds()
			post.Error = err.Error()
			auditor.Write(post)
			return
		}
		// Forward content-type and actor identity to the agent container.
		if ct := r.Header.Get("Content-Type"); ct != "" {
			req.Header.Set("Content-Type", ct)
		}
		req.Header.Set("X-Atom-Actor", r.Header.Get("X-Atom-Actor"))
		req.Header.Set("X-Gate-Run-Id", gateRunID)

		// Allow long-running agent invocations (codegen + reasoning can take minutes).
		client := &http.Client{Timeout: 10 * time.Minute}
		resp, err := client.Do(req)
		if err != nil {
			logger.Error("agent invoke failed", "name", name, "url", targetURL, "err", err)
			http.Error(w, fmt.Sprintf("agent invoke failed: %v", err), http.StatusBadGateway)
			post := pre
			post.Phase = "post"
			post.StatusCode = http.StatusBadGateway
			post.DurationMS = time.Since(start).Milliseconds()
			post.Error = err.Error()
			auditor.Write(post)
			return
		}
		defer resp.Body.Close()

		// Stream response headers and body back to the caller.
		for k, vs := range resp.Header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body) //nolint:errcheck

		post := pre
		post.Phase = "post"
		post.StatusCode = resp.StatusCode
		post.DurationMS = time.Since(start).Milliseconds()
		auditor.Write(post)
	})
}

// AgentPassthroughHandler fetches a fixed path (e.g. /openapi.json) from the
// agent container directly, bypassing builder-backend. Used for Swagger export.
func AgentPassthroughHandler(db *DB, containerPath string, auditor *Auditor, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		id := extractIdentity(r)
		gateRunID := newGateRunID()
		start := time.Now()

		pre := GateAuditEvent{
			GateRunID: gateRunID, Timestamp: start.UTC().Format(time.RFC3339Nano),
			ActorID: id.ActorID, ActorType: id.ActorType,
			TargetType: "agent", TargetName: name,
			Method: r.Method, Path: r.URL.Path,
			Backend: "agent-container", Phase: "pre",
		}
		auditor.Write(pre)

		if db == nil {
			http.Error(w, "platform-db unavailable", http.StatusServiceUnavailable)
			return
		}
		endpoint, err := db.GetAgentEndpoint(name)
		if err != nil {
			http.Error(w, fmt.Sprintf("agent %q not found or not deployed", name), http.StatusNotFound)
			return
		}

		targetURL := strings.TrimRight(endpoint, "/") + containerPath
		client := &http.Client{Timeout: 10 * time.Second}
		resp, err := client.Get(targetURL)
		if err != nil {
			msg := fmt.Sprintf(
				"Agent container at %s is not reachable. The container may have stopped after a platform restart — redeploy the agent to restore it. (%v)",
				endpoint, err,
			)
			http.Error(w, msg, http.StatusServiceUnavailable)
			post := pre
			post.Phase = "post"
			post.StatusCode = http.StatusServiceUnavailable
			post.DurationMS = time.Since(start).Milliseconds()
			post.Error = err.Error()
			auditor.Write(post)
			return
		}
		defer resp.Body.Close()

		for k, vs := range resp.Header {
			for _, v := range vs {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body) //nolint:errcheck

		post := pre
		post.Phase = "post"
		post.StatusCode = resp.StatusCode
		post.DurationMS = time.Since(start).Milliseconds()
		auditor.Write(post)
	})
}
