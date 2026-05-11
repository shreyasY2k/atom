package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// GateAuditEvent is the canonical gate-level audit record.
// Written twice per audited request: phase="pre" (before forwarding) and phase="post" (after).
type GateAuditEvent struct {
	GateRunID  string `json:"gate_run_id"`
	Timestamp  string `json:"timestamp"`
	ActorID    string `json:"actor_id"`
	ActorType  string `json:"actor_type"`
	TargetType string `json:"target_type"`          // "agent" | "workflow"
	TargetName string `json:"target_name,omitempty"` // agent or workflow name from URL
	RunID      string `json:"run_id,omitempty"`      // workflow run_id if available
	Method     string `json:"method"`
	Path       string `json:"path"`
	Backend    string `json:"backend"` // "builder-backend" | "workflow-backend"
	StatusCode int    `json:"status_code,omitempty"`
	DurationMS int64  `json:"duration_ms,omitempty"`
	Phase      string `json:"phase"` // "pre" | "post"
	Error      string `json:"error,omitempty"`
}

type Auditor struct {
	client *minio.Client
	bucket string
	logger *slog.Logger
}

func NewAuditor(cfg Config, logger *slog.Logger) (*Auditor, error) {
	client, err := minio.New(cfg.MinioEndpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.MinioAccessKey, cfg.MinioSecretKey, ""),
		Secure: cfg.MinioSecure,
	})
	if err != nil {
		return nil, err
	}
	return &Auditor{client: client, bucket: cfg.AuditBucket, logger: logger}, nil
}

// Write persists an audit event to MinIO.
// Failures are logged but never returned — the gate must not block on audit writes.
func (a *Auditor) Write(ev GateAuditEvent) {
	b, err := json.Marshal(ev)
	if err != nil {
		a.logger.Error("gate audit marshal failed", "err", err)
		return
	}
	key := fmt.Sprintf("gate/%s/%s-%s.json",
		time.Now().UTC().Format("2006-01-02"),
		ev.GateRunID,
		ev.Phase,
	)
	_, err = a.client.PutObject(
		context.Background(),
		a.bucket, key,
		bytes.NewReader(b), int64(len(b)),
		minio.PutObjectOptions{ContentType: "application/json"},
	)
	if err != nil {
		a.logger.Warn("gate audit write failed", "key", key, "err", err)
	}
}

func newGateRunID() string {
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	return fmt.Sprintf("gate-%x", b)
}
