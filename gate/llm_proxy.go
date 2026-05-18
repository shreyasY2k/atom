package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"strings"
	"time"
)

// llmRequestMeta extracts the minimal fields we need from the OpenAI-compatible
// request body without buffering the full body into a string.
type llmRequestMeta struct {
	Model  string `json:"model"`
	User   string `json:"user"` // service_account_id set by agent code
	Stream *bool  `json:"stream"`
}

// statusCapturingWriter wraps an http.ResponseWriter to capture the status code
// written by the upstream proxy. It forwards all writes/flushes unchanged so
// SSE streaming is not disrupted.
type statusCapturingWriter struct {
	http.ResponseWriter
	status int
}

func (s *statusCapturingWriter) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusCapturingWriter) Write(b []byte) (int, error) {
	if s.status == 0 {
		s.status = http.StatusOK
	}
	return s.ResponseWriter.Write(b)
}

// Flush delegates to the underlying ResponseWriter if it supports flushing.
// Required so that SSE chunks are sent immediately to the caller.
func (s *statusCapturingWriter) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// newLLMGate returns an HTTP handler for the LLM proxy gate (:8083).
// Every OpenAI-compatible request is:
//  1. Read body → extract actor / model metadata
//  2. Pre-audit event → MinIO
//  3. Row inserted into llm_call_events in platform-db
//  4. Streamed to LiteLLM:4000 (original auth headers preserved)
//  5. Post-audit event → MinIO
//  6. Row updated in llm_call_events with status + latency
func newLLMGate(cfg Config, auditor *Auditor, db *DB, logger *slog.Logger) http.Handler {
	proxy := newReverseProxy(cfg.LiteLLMURL, 5*time.Minute)
	mux := http.NewServeMux()

	mux.HandleFunc("GET /gate/health", gateHealth("8083"))
	mux.Handle("/", LLMProxyHandler(proxy, auditor, db, logger))
	return mux
}

// LLMProxyHandler wraps the reverse proxy with pre/post audit events and DB
// call tracking. It reads the body once, restores it for the proxy, and never
// buffers the response body (streaming-safe).
func LLMProxyHandler(proxy *httputil.ReverseProxy, auditor *Auditor, db *DB, logger *slog.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := extractIdentity(r)
		gateRunID := newGateRunID()
		start := time.Now()

		w.Header().Set("X-Gate-Run-Id", gateRunID)

		// Read body to extract minimal metadata, then restore for proxy.
		var meta llmRequestMeta
		var body []byte
		if r.Body != nil && r.ContentLength != 0 {
			var readErr error
			body, readErr = io.ReadAll(io.LimitReader(r.Body, 1<<20)) // 1 MiB cap for metadata parse
			_ = r.Body.Close()
			if readErr == nil {
				_ = json.Unmarshal(body, &meta)
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			r.ContentLength = int64(len(body))
		}

		// Prefer the service_account_id from the request body (set by agents via
		// the `user` parameter) over the X-Atom-Actor header, since agent code
		// always sets user= but may not set the header.
		actorID := strings.TrimSpace(meta.User)
		if actorID == "" {
			actorID = id.ActorID
		}
		actorType := "agent"
		if actorID == "anonymous" || actorID == "" {
			actorType = id.ActorType
		}

		pre := GateAuditEvent{
			GateRunID:  gateRunID,
			Timestamp:  start.UTC().Format(time.RFC3339Nano),
			ActorID:    actorID,
			ActorType:  actorType,
			TargetType: "llm",
			TargetName: meta.Model,
			Method:     r.Method,
			Path:       r.URL.Path,
			Backend:    "litellm",
			Phase:      "pre",
		}
		auditor.Write(pre)

		// Propagate gate run ID so LiteLLM guardrails can correlate events.
		r.Header.Set("X-Gate-Run-Id", gateRunID)

		// Insert LLM call event; ignore errors so a DB outage never blocks LLM calls.
		var callRowID int64
		if db != nil {
			callRowID, _ = db.InsertLLMCall(r.Context(), LLMCallEvent{
				GateRunID:        gateRunID,
				ServiceAccountID: actorID,
				Model:            meta.Model,
				Path:             r.URL.Path,
			})
		}

		// Proxy the request. statusCapturingWriter forwards all bytes + flushes.
		sw := &statusCapturingWriter{ResponseWriter: w}
		proxy.ServeHTTP(sw, r)

		elapsed := time.Since(start).Milliseconds()
		statusCode := sw.status
		if statusCode == 0 {
			statusCode = http.StatusOK
		}

		post := pre
		post.Phase = "post"
		post.StatusCode = statusCode
		post.DurationMS = elapsed
		auditor.Write(post)

		if db != nil && callRowID > 0 {
			_ = db.UpdateLLMCall(context.Background(), callRowID, statusCode, elapsed)
		}
	})
}
