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
