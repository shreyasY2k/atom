package policy

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/open-policy-agent/opa/v1/rego"
)

const (
	reloadDebounce = 2 * time.Second
)

// Decision is the result of evaluating data.atom.authz.
type Decision struct {
	Allow  bool
	Reason string // populated when Allow is false
}

// Manager loads OPA policies from disk and evaluates them in-process.
// File changes trigger an automatic hot-reload (debounced at 2s).
type Manager struct {
	mu          sync.RWMutex
	policyDir   string
	allowPQ     rego.PreparedEvalQuery
	denyPQ      rego.PreparedEvalQuery
	watcher     *fsnotify.Watcher
	reloadTimer *time.Timer
}

// NewManager creates a Manager, loads policies from policyDir, and starts
// a background fsnotify watcher for hot-reload.
func NewManager(ctx context.Context, policyDir string) (*Manager, error) {
	m := &Manager{policyDir: policyDir}

	if err := m.load(ctx); err != nil {
		return nil, fmt.Errorf("initial policy load: %w", err)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, fmt.Errorf("create fsnotify watcher: %w", err)
	}
	if err := watcher.Add(policyDir); err != nil {
		watcher.Close()
		return nil, fmt.Errorf("watch policy dir %q: %w", policyDir, err)
	}
	m.watcher = watcher
	go m.watchLoop(ctx)

	return m, nil
}

// Eval evaluates the ATOM authz policy against input and returns a Decision.
func (m *Manager) Eval(ctx context.Context, input map[string]any) (Decision, error) {
	m.mu.RLock()
	allowPQ := m.allowPQ
	denyPQ := m.denyPQ
	m.mu.RUnlock()

	// Evaluate allow rule.
	rs, err := allowPQ.Eval(ctx, rego.EvalInput(input))
	if err != nil {
		return Decision{}, fmt.Errorf("eval allow: %w", err)
	}
	allowed := len(rs) > 0 && rs[0].Expressions[0].Value == true

	if allowed {
		return Decision{Allow: true}, nil
	}

	// Collect deny reasons.
	reason := m.denyReason(ctx, denyPQ, input)
	return Decision{Allow: false, Reason: reason}, nil
}

// Close shuts down the background watcher.
func (m *Manager) Close() {
	if m.watcher != nil {
		m.watcher.Close()
	}
}

func (m *Manager) load(ctx context.Context) error {
	allowPQ, err := prepareQuery(ctx, m.policyDir, "data.atom.authz.allow")
	if err != nil {
		return fmt.Errorf("prepare allow query: %w", err)
	}
	denyPQ, err := prepareQuery(ctx, m.policyDir, "data.atom.authz.deny")
	if err != nil {
		return fmt.Errorf("prepare deny query: %w", err)
	}

	m.mu.Lock()
	m.allowPQ = allowPQ
	m.denyPQ = denyPQ
	m.mu.Unlock()
	return nil
}

func prepareQuery(ctx context.Context, policyDir, query string) (rego.PreparedEvalQuery, error) {
	r := rego.New(
		rego.Query(query),
		rego.Load([]string{policyDir}, func(abspath string, info os.FileInfo, depth int) bool {
			// Skip non-.rego files (return true = skip).
			return filepath.Ext(abspath) != ".rego"
		}),
	)
	pq, err := r.PrepareForEval(ctx)
	if err != nil {
		return rego.PreparedEvalQuery{}, fmt.Errorf("PrepareForEval(%q): %w", query, err)
	}
	return pq, nil
}

func (m *Manager) denyReason(ctx context.Context, denyPQ rego.PreparedEvalQuery, input map[string]any) string {
	rs, err := denyPQ.Eval(ctx, rego.EvalInput(input))
	if err != nil || len(rs) == 0 {
		return "policy denied"
	}
	// deny is a set of objects: [{reason: "..."}]
	val := rs[0].Expressions[0].Value
	set, ok := val.([]interface{})
	if !ok || len(set) == 0 {
		return "policy denied"
	}
	if obj, ok := set[0].(map[string]interface{}); ok {
		if r, ok := obj["reason"].(string); ok {
			return r
		}
	}
	return "policy denied"
}

func (m *Manager) watchLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-m.watcher.Events:
			if !ok {
				return
			}
			if filepath.Ext(event.Name) != ".rego" {
				continue
			}
			// Debounce: reset timer on each change.
			m.mu.Lock()
			if m.reloadTimer != nil {
				m.reloadTimer.Stop()
			}
			m.reloadTimer = time.AfterFunc(reloadDebounce, func() {
				if err := m.load(ctx); err != nil {
					slog.Error("policy hot-reload failed", "err", err)
				} else {
					slog.Info("policies hot-reloaded", "file", event.Name)
				}
			})
			m.mu.Unlock()
		case err, ok := <-m.watcher.Errors:
			if !ok {
				return
			}
			slog.Error("fsnotify watcher error", "err", err)
		}
	}
}
