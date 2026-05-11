package main

import (
	"log/slog"
	"net/http"
	"time"
)

// statusCapture wraps a ResponseWriter to capture the status code after the
// proxy writes it. Also implements Flusher so SSE streams work through the gate.
type statusCapture struct {
	http.ResponseWriter
	code int
}

func (s *statusCapture) WriteHeader(code int) {
	s.code = code
	s.ResponseWriter.WriteHeader(code)
}

func (s *statusCapture) Flush() {
	if f, ok := s.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// LoggingMiddleware logs every request/response through the gate as structured
// JSON. Runs on all routes (audited and passthrough alike). For audited routes
// the gate_run_id is already set on the response header by AuditWrap, so the
// logger picks it up after the handler returns.
func LoggingMiddleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := extractIdentity(r)
		sc := &statusCapture{ResponseWriter: w, code: http.StatusOK}

		next.ServeHTTP(sc, r)

		logger.Info("gate",
			"method", r.Method,
			"path", r.URL.Path,
			"query", r.URL.RawQuery,
			"status", sc.code,
			"duration_ms", time.Since(start).Milliseconds(),
			"actor_id", id.ActorID,
			"actor_type", id.ActorType,
			"gate_run_id", w.Header().Get("X-Gate-Run-Id"),
			"remote_addr", r.RemoteAddr,
			"user_agent", r.UserAgent(),
		)
	})
}

// AuditWrap returns a handler that writes gate audit records around the given
// handler. The pre-audit fires synchronously before forwarding; the post-audit
// fires after the backend response is fully sent (or the SSE stream closes).
func AuditWrap(next http.Handler, auditor *Auditor, backend, targetType string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := extractIdentity(r)
		gid := newGateRunID()
		start := time.Now()

		pre := GateAuditEvent{
			GateRunID:  gid,
			Timestamp:  start.UTC().Format(time.RFC3339Nano),
			ActorID:    id.ActorID,
			ActorType:  id.ActorType,
			TargetType: targetType,
			TargetName: r.PathValue("name"),
			RunID:      r.PathValue("run_id"),
			Method:     r.Method,
			Path:       r.URL.Path,
			Backend:    backend,
			Phase:      "pre",
		}
		auditor.Write(pre)

		// Propagate gate run ID to the backend and to the response caller.
		r.Header.Set("X-Gate-Run-Id", gid)
		w.Header().Set("X-Gate-Run-Id", gid)

		sc := &statusCapture{ResponseWriter: w, code: http.StatusOK}
		next.ServeHTTP(sc, r)

		post := pre
		post.Phase = "post"
		post.StatusCode = sc.code
		post.DurationMS = time.Since(start).Milliseconds()
		auditor.Write(post)
	})
}
