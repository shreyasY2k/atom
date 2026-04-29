package auth

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	claimsKey      = "claims"
	revokeCacheTTL = 60 * time.Second
)

// Claims represents the ATOM JWT payload for both human and agent tokens.
type Claims struct {
	jwt.RegisteredClaims
	Type     string `json:"type"`                // "human" | "agent"
	Role     string `json:"role,omitempty"`      // "admin" | "developer" (human only)
	DomainID string `json:"domain_id,omitempty"` // agent tokens only
	AgentID  string `json:"agent_id,omitempty"`  // agent tokens only
}

// Middleware returns a Fiber middleware that validates RS256 JWTs.
// If pubKey is nil (JWT_PUBLIC_KEY_PATH not set), all tokens are rejected.
func Middleware(pubKey *rsa.PublicKey, pool *pgxpool.Pool, rdb *redis.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		raw, err := extractBearer(c)
		if err != nil {
			return unauthorized(c, "missing_token")
		}

		claims, err := parseToken(raw, pubKey)
		if err != nil {
			if isExpired(err) {
				return unauthorized(c, "token_expired")
			}
			return unauthorized(c, "invalid_token")
		}

		// Revocation check for agent tokens only.
		if claims.Type == "agent" {
			if revoked, checkErr := isRevoked(c.Context(), raw, pool, rdb); checkErr != nil {
				// Log but don't fail — revocation check is best-effort
				_ = checkErr
			} else if revoked {
				return unauthorized(c, "token_revoked")
			}
		}

		c.Locals(claimsKey, claims)
		return c.Next()
	}
}

// GetClaims retrieves validated claims from the request context.
func GetClaims(c fiber.Ctx) (*Claims, bool) {
	v := c.Locals(claimsKey)
	if v == nil {
		return nil, false
	}
	claims, ok := v.(*Claims)
	return claims, ok
}

func extractBearer(c fiber.Ctx) (string, error) {
	h := c.Get("Authorization")
	if h == "" {
		return "", fmt.Errorf("no Authorization header")
	}
	parts := strings.SplitN(h, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return "", fmt.Errorf("malformed Authorization header")
	}
	return parts[1], nil
}

func parseToken(raw string, pubKey *rsa.PublicKey) (*Claims, error) {
	if pubKey == nil {
		return nil, fmt.Errorf("no public key configured")
	}
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return pubKey, nil
	}, jwt.WithIssuedAt())
	// Note: ExpirationRequired is intentionally omitted — agent tokens have no exp claim;
	// revocation is handled via agent_tokens.revoked_at in Postgres.
	if err != nil {
		return nil, err
	}
	return claims, nil
}

func isExpired(err error) bool {
	return strings.Contains(err.Error(), "token is expired")
}

// isRevoked checks Redis first (TTL 60s) then falls back to Postgres.
func isRevoked(ctx context.Context, rawToken string, pool *pgxpool.Pool, rdb *redis.Client) (bool, error) {
	hash := tokenHash(rawToken)
	cacheKey := "agent_token:revoked:" + hash

	// Redis fast path
	val, err := rdb.Get(ctx, cacheKey).Result()
	if err == nil {
		return val == "1", nil
	}
	if err != redis.Nil {
		return false, fmt.Errorf("redis get: %w", err)
	}

	// Postgres fallback
	var revokedAt *time.Time
	row := pool.QueryRow(ctx,
		`SELECT revoked_at FROM agent_tokens WHERE token_hash = $1 LIMIT 1`, hash)
	if scanErr := row.Scan(&revokedAt); scanErr != nil {
		// No row or scan error — treat as not revoked
		_ = rdb.Set(ctx, cacheKey, "0", revokeCacheTTL)
		return false, nil
	}

	revoked := revokedAt != nil
	cacheVal := "0"
	if revoked {
		cacheVal = "1"
	}
	_ = rdb.Set(ctx, cacheKey, cacheVal, revokeCacheTTL)
	return revoked, nil
}

func tokenHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func unauthorized(c fiber.Ctx, reason string) error {
	return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": reason})
}
