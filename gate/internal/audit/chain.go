package audit

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	kafkago "github.com/segmentio/kafka-go"

	"github.com/your-org/atom/gate/internal/auth"
	"github.com/your-org/atom/gate/internal/policy"
)

const (
	genesisHash = "genesis"
	jobBufSize  = 4096
)

// Event is the JSON payload recorded in audit_log_chain.event.
type Event struct {
	Timestamp       time.Time `json:"timestamp"`
	DomainID        string    `json:"domain_id,omitempty"`
	AgentID         string    `json:"agent_id,omitempty"`
	TokenType       string    `json:"token_type,omitempty"`
	CallerTokenHash string    `json:"caller_token_hash,omitempty"`
	Method          string    `json:"method"`
	Path            string    `json:"path"`
	PolicyDecision  struct {
		Allow  bool   `json:"allow"`
		Reason string `json:"reason"`
	} `json:"policy_decision"`
	StatusCode int `json:"status_code"`
	LatencyMs  int `json:"latency_ms"`
}

type job struct {
	event Event
	raw   string // raw JWT for token hash
}

// Logger appends every request to the hash-chained audit_log_chain table.
// Writes are serialised through a single goroutine to guarantee chain integrity.
type Logger struct {
	pool   *pgxpool.Pool
	secret []byte
	ch     chan job
	kafka  *kafkago.Writer // nil when no brokers configured
}

func New(pool *pgxpool.Pool, hmacSecret string, kafkaBrokers []string) *Logger {
	l := &Logger{
		pool:   pool,
		secret: []byte(hmacSecret),
		ch:     make(chan job, jobBufSize),
	}
	if len(kafkaBrokers) > 0 {
		l.kafka = &kafkago.Writer{
			Addr:        kafkago.TCP(kafkaBrokers...),
			Topic:       "atom.audit",
			Balancer:    &kafkago.LeastBytes{},
			Async:       true,
			MaxAttempts: 3,
		}
	}
	go l.worker()
	return l
}

// Middleware records an audit entry after each request completes.
func (l *Logger) Middleware() fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		err := c.Next()

		ev := Event{
			Timestamp:  start,
			Method:     c.Method(),
			Path:       c.Path(),
			StatusCode: c.Response().StatusCode(),
			LatencyMs:  int(time.Since(start).Milliseconds()),
		}

		if claims, ok := auth.GetClaims(c); ok {
			ev.DomainID = claims.DomainID
			ev.AgentID = claims.AgentID
			ev.TokenType = claims.Type
		}

		if pd := policy.GetPolicyDecision(c); pd != nil {
			ev.PolicyDecision.Allow = pd.Allow
			ev.PolicyDecision.Reason = pd.Reason
		} else {
			ev.PolicyDecision.Allow = true // health/readyz bypass OPA
		}

		// Non-blocking send — drop if buffer is full.
		rawToken := c.Get("Authorization")
		select {
		case l.ch <- job{event: ev, raw: rawToken}:
		default:
			slog.Warn("audit buffer full — entry dropped", "path", ev.Path)
		}

		return err
	}
}

// Close drains the channel and shuts down the Kafka writer.
func (l *Logger) Close() {
	close(l.ch)
	if l.kafka != nil {
		_ = l.kafka.Close()
	}
}

func (l *Logger) worker() {
	for j := range l.ch {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := l.write(ctx, j); err != nil {
			slog.Error("audit write failed", "err", err)
		}
		cancel()
	}
}

func (l *Logger) write(ctx context.Context, j job) error {
	eventJSON, err := json.Marshal(j.event)
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}

	prevHash, err := l.lastHash(ctx)
	if err != nil {
		return fmt.Errorf("fetch last hash: %w", err)
	}

	mac := computeHMAC(l.secret, prevHash, eventJSON)

	_, err = l.pool.Exec(ctx,
		`INSERT INTO audit_log_chain (prev_hash, event, hmac)
		 VALUES ($1, $2, $3)`,
		prevHash, eventJSON, mac,
	)
	if err != nil {
		return fmt.Errorf("insert audit entry: %w", err)
	}

	if l.kafka != nil {
		_ = l.kafka.WriteMessages(ctx, kafkago.Message{Value: eventJSON})
	}
	return nil
}

// lastHash returns sha256(last event JSON) or "genesis" if the table is empty.
func (l *Logger) lastHash(ctx context.Context) (string, error) {
	var eventJSON []byte
	err := l.pool.QueryRow(ctx,
		`SELECT event FROM audit_log_chain ORDER BY seq DESC LIMIT 1`).
		Scan(&eventJSON)
	if err != nil {
		// Table empty — first entry uses genesis hash.
		return genesisHash, nil //nolint:nilerr
	}
	sum := sha256.Sum256(eventJSON)
	return hex.EncodeToString(sum[:]), nil
}

func computeHMAC(secret []byte, prevHash string, eventJSON []byte) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(prevHash))
	h.Write(eventJSON)
	return hex.EncodeToString(h.Sum(nil))
}

// ValidateChain verifies the integrity of the last n entries.
// Returns nil if the chain is intact.
func ValidateChain(ctx context.Context, pool *pgxpool.Pool, secret []byte, n int) error {
	rows, err := pool.Query(ctx,
		`SELECT seq, prev_hash, event, hmac
		 FROM audit_log_chain
		 ORDER BY seq DESC
		 LIMIT $1`, n)
	if err != nil {
		return fmt.Errorf("query chain: %w", err)
	}
	defer rows.Close()

	type entry struct {
		seq      int64
		prevHash string
		event    []byte
		mac      string
	}

	entries := make([]entry, 0, n)
	for rows.Next() {
		var e entry
		if scanErr := rows.Scan(&e.seq, &e.prevHash, &e.event, &e.mac); scanErr != nil {
			return fmt.Errorf("scan row: %w", scanErr)
		}
		entries = append(entries, e)
	}

	// Reverse to oldest-first for chain validation.
	for i, j := 0, len(entries)-1; i < j; i, j = i+1, j-1 {
		entries[i], entries[j] = entries[j], entries[i]
	}

	for i, e := range entries {
		expected := computeHMAC(secret, e.prevHash, e.event)
		if expected != e.mac {
			return fmt.Errorf("chain broken at seq %d: HMAC mismatch", e.seq)
		}
		if i > 0 {
			prevSum := sha256.Sum256(entries[i-1].event)
			expectedPrev := hex.EncodeToString(prevSum[:])
			if expectedPrev != e.prevHash {
				return fmt.Errorf("chain broken at seq %d: prev_hash mismatch", e.seq)
			}
		}
	}
	return nil
}
