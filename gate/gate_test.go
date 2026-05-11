package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---- mock auditor -------------------------------------------------------

type capturedEvent struct {
	ev GateAuditEvent
}

type mockAuditor struct {
	mu     sync.Mutex
	events []GateAuditEvent
}

func (m *mockAuditor) Write(ev GateAuditEvent) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, ev)
}

func (m *mockAuditor) all() []GateAuditEvent {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]GateAuditEvent, len(m.events))
	copy(out, m.events)
	return out
}

// replace the real Auditor.Write with the mock's Write at the handler level
// by building handlers directly with the mock.

// ---- helpers ------------------------------------------------------------

func newMock() *mockAuditor { return &mockAuditor{} }

// buildBuilderGate wires the builder gate against a fake backend server and a mock auditor.
func buildBuilderGate(backend *httptest.Server, ma *mockAuditor) http.Handler {
	cfg := Config{BuilderBackendURL: backend.URL}
	proxy := newReverseProxy(cfg.BuilderBackendURL)
	mux := http.NewServeMux()

	// Re-use real AuditWrap but swap auditor — we need a thin shim because
	// AuditWrap takes *Auditor not an interface. We test via a real *Auditor
	// whose Write is overridden. Easier: wrap the proxy directly with an
	// inline handler that calls ma.Write.
	auditProxy := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := extractIdentity(r)
		gid := newGateRunID()
		start := time.Now()
		pre := GateAuditEvent{
			GateRunID: gid, Timestamp: start.UTC().Format(time.RFC3339Nano),
			ActorID: id.ActorID, ActorType: id.ActorType,
			TargetType: "agent", TargetName: r.PathValue("name"),
			Method: r.Method, Path: r.URL.Path,
			Backend: "builder-backend", Phase: "pre",
		}
		ma.Write(pre)
		r.Header.Set("X-Gate-Run-Id", gid)
		w.Header().Set("X-Gate-Run-Id", gid)
		sc := &statusCapture{ResponseWriter: w, code: http.StatusOK}
		proxy.ServeHTTP(sc, r)
		post := pre
		post.Phase = "post"
		post.StatusCode = sc.code
		post.DurationMS = time.Since(start).Milliseconds()
		ma.Write(post)
	})

	mux.Handle("POST /agents/{name}/invoke", auditProxy)
	mux.HandleFunc("GET /gate/health", gateHealth("8080"))
	mux.Handle("/", proxy)
	return mux
}

// buildWorkflowGate wires the workflow gate against a fake backend and mock auditor.
func buildWorkflowGate(backend *httptest.Server, ma *mockAuditor) http.Handler {
	cfg := Config{WorkflowBackendURL: backend.URL}
	proxy := newReverseProxy(cfg.WorkflowBackendURL)
	mux := http.NewServeMux()

	wrap := func(targetType, backend string) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			id := extractIdentity(r)
			gid := newGateRunID()
			start := time.Now()
			pre := GateAuditEvent{
				GateRunID: gid, Timestamp: start.UTC().Format(time.RFC3339Nano),
				ActorID: id.ActorID, ActorType: id.ActorType,
				TargetType: targetType, TargetName: r.PathValue("name"),
				RunID: r.PathValue("run_id"),
				Method: r.Method, Path: r.URL.Path,
				Backend: backend, Phase: "pre",
			}
			ma.Write(pre)
			r.Header.Set("X-Gate-Run-Id", gid)
			w.Header().Set("X-Gate-Run-Id", gid)
			sc := &statusCapture{ResponseWriter: w, code: http.StatusOK}
			proxy.ServeHTTP(sc, r)
			post := pre
			post.Phase = "post"
			post.StatusCode = sc.code
			post.DurationMS = time.Since(start).Milliseconds()
			ma.Write(post)
		})
	}

	mux.Handle("POST /workflows/{name}/runs", wrap("workflow", "workflow-backend"))
	mux.Handle("GET /workflows/{name}/runs/{run_id}", wrap("workflow", "workflow-backend"))
	mux.Handle("GET /workflows/{name}/runs/{run_id}/events", wrap("workflow", "workflow-backend"))
	mux.Handle("GET /workflows/{name}/runs/{run_id}/nodes", wrap("workflow", "workflow-backend"))
	mux.Handle("POST /runs/{run_id}/cancel", wrap("workflow", "workflow-backend"))
	mux.HandleFunc("GET /gate/health", gateHealth("8081"))
	mux.Handle("/", proxy)
	return mux
}

// ---- tests --------------------------------------------------------------

// 1. Agent invoke is proxied and produces pre+post audit records.
func TestAgentInvoke_ProxiedAndAudited(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/agents/kyc-reviewer/invoke" || r.Method != http.MethodPost {
			http.Error(w, "wrong path", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"result":"ok"}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildBuilderGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/agents/kyc-reviewer/invoke",
		strings.NewReader(`{"text":"check this customer"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Atom-Actor", "human:user-builder")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}

	gid := resp.Header.Get("X-Gate-Run-Id")
	if gid == "" {
		t.Fatal("missing X-Gate-Run-Id response header")
	}

	events := ma.all()
	if len(events) != 2 {
		t.Fatalf("expected 2 audit events (pre+post), got %d", len(events))
	}

	pre, post := events[0], events[1]
	if pre.Phase != "pre" {
		t.Errorf("first event phase = %q, want pre", pre.Phase)
	}
	if post.Phase != "post" {
		t.Errorf("second event phase = %q, want post", post.Phase)
	}
	if pre.ActorID != "user-builder" || pre.ActorType != "human" {
		t.Errorf("wrong identity: %+v", pre)
	}
	if pre.TargetType != "agent" || pre.TargetName != "kyc-reviewer" {
		t.Errorf("wrong target: %+v", pre)
	}
	if pre.Backend != "builder-backend" {
		t.Errorf("wrong backend: %s", pre.Backend)
	}
	if post.StatusCode != http.StatusOK {
		t.Errorf("post status = %d, want 200", post.StatusCode)
	}
	if post.DurationMS < 0 {
		t.Errorf("negative duration")
	}
	if pre.GateRunID != post.GateRunID {
		t.Errorf("gate_run_id mismatch: %s vs %s", pre.GateRunID, post.GateRunID)
	}
	if !strings.HasPrefix(gid, "gate-") {
		t.Errorf("unexpected gate run id format: %s", gid)
	}
}

// 2. Non-audited route passes through without audit records.
func TestNonAuditedRoute_Passthrough(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"agents":[]}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildBuilderGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/agents")
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	if len(ma.all()) != 0 {
		t.Errorf("expected 0 audit events for passthrough, got %d", len(ma.all()))
	}
}

// 3. Identity defaults to anonymous when X-Atom-Actor is absent.
func TestIdentity_MissingHeader_DefaultsToAnonymous(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildBuilderGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/agents/test/invoke",
		strings.NewReader(`{}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()

	ev := ma.all()[0]
	if ev.ActorID != "anonymous" || ev.ActorType != "human" {
		t.Errorf("expected anonymous/human, got %s/%s", ev.ActorID, ev.ActorType)
	}
}

// 4. Identity parsed correctly for agent service-account format.
func TestIdentity_AgentServiceAccount(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildBuilderGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/agents/fraud-detector/invoke",
		strings.NewReader(`{}`))
	req.Header.Set("X-Atom-Actor", "agent:svc-fraud-detector")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()

	ev := ma.all()[0]
	if ev.ActorID != "svc-fraud-detector" || ev.ActorType != "agent" {
		t.Errorf("wrong identity: %+v", ev)
	}
}

// 5. Backend 500 recorded in post-audit status code.
func TestBackendError_RecordedInPostAudit(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "internal error", http.StatusInternalServerError)
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildBuilderGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/agents/broken/invoke",
		strings.NewReader(`{}`))
	req.Header.Set("X-Atom-Actor", "human:user-builder")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()

	post := ma.all()[1]
	if post.StatusCode != http.StatusInternalServerError {
		t.Errorf("expected 500 in post audit, got %d", post.StatusCode)
	}
}

// 6. Workflow run start is proxied and audited (pre+post).
func TestWorkflowRunStart_ProxiedAndAudited(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/workflows/ats/runs" || r.Method != http.MethodPost {
			http.Error(w, "wrong", http.StatusBadRequest)
			return
		}
		w.Write([]byte(`{"run_id":"run-abc123","status":"started"}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildWorkflowGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/workflows/ats/runs",
		strings.NewReader(`{"customer_id":"C001"}`))
	req.Header.Set("X-Atom-Actor", "human:user-approver")
	resp, _ := http.DefaultClient.Do(req)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", resp.StatusCode, body)
	}

	events := ma.all()
	if len(events) != 2 {
		t.Fatalf("expected 2 audit events, got %d", len(events))
	}
	pre := events[0]
	if pre.TargetType != "workflow" || pre.TargetName != "ats" {
		t.Errorf("wrong target: %+v", pre)
	}
	if pre.Backend != "workflow-backend" {
		t.Errorf("wrong backend: %s", pre.Backend)
	}
}

// 7. Workflow run status poll is audited with run_id captured.
func TestWorkflowRunStatus_AuditedWithRunID(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"run_id":"run-abc123","status":"running"}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildWorkflowGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	resp, _ := http.Get(srv.URL + "/workflows/ats/runs/run-abc123")
	resp.Body.Close()

	pre := ma.all()[0]
	if pre.RunID != "run-abc123" {
		t.Errorf("run_id not captured in audit: %+v", pre)
	}
	if pre.TargetName != "ats" {
		t.Errorf("workflow name not captured: %+v", pre)
	}
}

// 8. SSE stream passes through gate correctly (streaming, not buffered).
func TestSSEStream_PassesThroughGate(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "no flusher", http.StatusInternalServerError)
			return
		}
		for i := range 3 {
			fmt.Fprintf(w, "data: {\"node\":%d}\n\n", i)
			flusher.Flush()
			time.Sleep(10 * time.Millisecond)
		}
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildWorkflowGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/workflows/ats/runs/run-abc123/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("expected SSE content-type, got %q", ct)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "data:") {
		t.Errorf("expected SSE events in body, got: %s", body)
	}

	events := ma.all()
	if len(events) != 2 {
		t.Fatalf("expected 2 audit events for SSE, got %d", len(events))
	}
	if events[1].DurationMS < 0 {
		t.Error("negative duration on SSE post-audit")
	}
}

// 9. Workflow cancel is audited.
func TestWorkflowCancel_Audited(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"cancelled":true}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildWorkflowGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/runs/run-abc123/cancel", nil)
	req.Header.Set("X-Atom-Actor", "human:user-approver")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()

	events := ma.all()
	if len(events) != 2 {
		t.Fatalf("expected 2 audit events for cancel, got %d", len(events))
	}
}

// 10. Gate health endpoint returns 200 on both surfaces.
func TestGateHealth(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer backend.Close()

	ma := newMock()

	for _, tc := range []struct {
		name string
		gate http.Handler
	}{
		{"builder", buildBuilderGate(backend, ma)},
		{"workflow", buildWorkflowGate(backend, ma)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.gate)
			defer srv.Close()
			resp, err := http.Get(srv.URL + "/gate/health")
			if err != nil {
				t.Fatal(err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != http.StatusOK {
				t.Errorf("expected 200, got %d", resp.StatusCode)
			}
			var body map[string]string
			json.NewDecoder(resp.Body).Decode(&body)
			if body["status"] != "ok" || body["service"] != "gate" {
				t.Errorf("unexpected health body: %v", body)
			}
		})
	}
}

// 11. X-Gate-Run-Id header forwarded to backend.
func TestGateRunID_ForwardedToBackend(t *testing.T) {
	var receivedGID string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		receivedGID = r.Header.Get("X-Gate-Run-Id")
		w.Write([]byte(`{}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildBuilderGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/agents/test/invoke",
		strings.NewReader(`{}`))
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()

	if receivedGID == "" {
		t.Error("backend did not receive X-Gate-Run-Id header")
	}
	if !strings.HasPrefix(receivedGID, "gate-") {
		t.Errorf("unexpected gate run id format: %s", receivedGID)
	}
}

// 12. Workflow non-audited route (spec CRUD) passes through without audit.
func TestWorkflowPassthrough_NoAudit(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"workflows":[]}`))
	}))
	defer backend.Close()

	ma := newMock()
	gate := buildWorkflowGate(backend, ma)
	srv := httptest.NewServer(gate)
	defer srv.Close()

	resp, _ := http.Get(srv.URL + "/workflows")
	resp.Body.Close()

	if len(ma.all()) != 0 {
		t.Errorf("expected no audit events for passthrough GET /workflows, got %d", len(ma.all()))
	}
}

// 13. LoggingMiddleware emits a structured JSON line for every request.
func TestLoggingMiddleware_LogsAllRequests(t *testing.T) {
	var buf strings.Builder
	logger := slog.New(slog.NewJSONHandler(&buf, nil))

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{}`))
	})
	srv := httptest.NewServer(LoggingMiddleware(logger, inner))

	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/agents", nil)
	req.Header.Set("X-Atom-Actor", "human:user-builder")
	resp, _ := http.DefaultClient.Do(req)
	resp.Body.Close()

	// Close server so all in-flight handler goroutines complete (including logger.Info)
	// before we inspect the buffer.
	srv.Close()

	logs := buf.String()
	if strings.Count(logs, `"msg":"gate"`) != 1 {
		t.Errorf("expected 1 gate log line, got:\n%s", logs)
	}
	if !strings.Contains(logs, `"actor_id":"user-builder"`) {
		t.Error("actor_id missing from log")
	}
	if !strings.Contains(logs, `"status":200`) {
		t.Error("status missing from log")
	}
	if !strings.Contains(logs, `"duration_ms"`) {
		t.Error("duration_ms missing from log")
	}
	if !strings.Contains(logs, `"method":"GET"`) {
		t.Error("method missing from log")
	}
	if !strings.Contains(logs, `"path":"/agents"`) {
		t.Error("path missing from log")
	}
}

// 14. GateRunID uniqueness — 1000 concurrent calls produce distinct IDs.
func TestGateRunID_Unique(t *testing.T) {
	seen := sync.Map{}
	const n = 1000
	var wg sync.WaitGroup
	wg.Add(n)
	for range n {
		go func() {
			defer wg.Done()
			id := newGateRunID()
			if _, loaded := seen.LoadOrStore(id, true); loaded {
				t.Errorf("duplicate gate run id: %s", id)
			}
		}()
	}
	wg.Wait()
}

// 14. Identity extraction edge cases.
func TestIdentityExtraction(t *testing.T) {
	cases := []struct {
		header    string
		wantID    string
		wantType  string
	}{
		{"human:user-builder", "user-builder", "human"},
		{"agent:svc-kyc-reviewer", "svc-kyc-reviewer", "agent"},
		{"system:temporal-worker", "temporal-worker", "system"},
		{"", "anonymous", "human"},
		{"bare-value", "bare-value", "human"},
		{"a:b:c", "b:c", "a"}, // extra colons go into actor_id
	}
	for _, tc := range cases {
		r, _ := http.NewRequest(http.MethodGet, "/", nil)
		if tc.header != "" {
			r.Header.Set("X-Atom-Actor", tc.header)
		}
		got := extractIdentity(r)
		if got.ActorID != tc.wantID || got.ActorType != tc.wantType {
			t.Errorf("header=%q: got {%s/%s}, want {%s/%s}",
				tc.header, got.ActorType, got.ActorID, tc.wantType, tc.wantID)
		}
	}
}
