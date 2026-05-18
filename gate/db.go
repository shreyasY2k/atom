package main

// Run: go mod tidy  after adding github.com/jackc/pgx/v5 to go.mod.

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB wraps a pgxpool connection pool to platform-db.
type DB struct {
	pool *pgxpool.Pool
}

// NewDB opens a pooled connection to PostgreSQL using connStr.
// Returns an error if the pool cannot be established within 10 seconds.
func NewDB(connStr string) (*DB, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		return nil, fmt.Errorf("pgxpool.New: %w", err)
	}
	return &DB{pool: pool}, nil
}

// CreateSecurityTables ensures llm_call_events and guardrail_events tables
// exist. Called once at startup; idempotent (CREATE TABLE IF NOT EXISTS).
func (db *DB) CreateSecurityTables() error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	_, err := db.pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS llm_call_events (
			id                  SERIAL PRIMARY KEY,
			gate_run_id         TEXT NOT NULL,
			service_account_id  TEXT,
			model               TEXT,
			path                TEXT,
			status_code         INTEGER,
			latency_ms          BIGINT,
			created_at          TIMESTAMPTZ DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS llm_call_events_svc_idx ON llm_call_events (service_account_id, created_at);

		CREATE TABLE IF NOT EXISTS guardrail_events (
			id                  SERIAL PRIMARY KEY,
			gate_run_id         TEXT,
			service_account_id  TEXT,
			agent_name          TEXT,
			layer               TEXT NOT NULL,
			phase               TEXT NOT NULL,
			verdict             TEXT NOT NULL,
			threat_type         TEXT,
			threat_level        TEXT,
			pii_types           TEXT,
			created_at          TIMESTAMPTZ DEFAULT NOW()
		);
		CREATE INDEX IF NOT EXISTS guardrail_events_svc_idx ON guardrail_events (service_account_id, created_at);
	`)
	return err
}

// GetAgentEndpoint returns the endpoint URL for a deployed agent by name.
// Returns an error if the agent does not exist or is not in status='deployed'.
func (db *DB) GetAgentEndpoint(name string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var endpoint string
	err := db.pool.QueryRow(ctx,
		"SELECT endpoint FROM agents WHERE name=$1 AND status='deployed'",
		name,
	).Scan(&endpoint)
	if err != nil {
		return "", fmt.Errorf("agent %q not found or not deployed: %w", name, err)
	}
	return endpoint, nil
}

// LLMCallEvent holds the metadata for a single LLM call through the proxy.
type LLMCallEvent struct {
	GateRunID        string
	ServiceAccountID string
	Model            string
	Path             string
}

// InsertLLMCall creates a new llm_call_events row and returns the new row id.
// Returns 0 on any error so callers can skip the follow-up UpdateLLMCall.
func (db *DB) InsertLLMCall(ctx context.Context, ev LLMCallEvent) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	var id int64
	err := db.pool.QueryRow(ctx,
		`INSERT INTO llm_call_events (gate_run_id, service_account_id, model, path)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		ev.GateRunID, ev.ServiceAccountID, ev.Model, ev.Path,
	).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("InsertLLMCall: %w", err)
	}
	return id, nil
}

// UpdateLLMCall fills in status_code and latency_ms after the upstream returns.
func (db *DB) UpdateLLMCall(ctx context.Context, id int64, statusCode int, latencyMS int64) error {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	_, err := db.pool.Exec(ctx,
		`UPDATE llm_call_events SET status_code=$1, latency_ms=$2 WHERE id=$3`,
		statusCode, latencyMS, id,
	)
	return err
}
