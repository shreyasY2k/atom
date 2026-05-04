package ratelimit

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/redis/go-redis/v9"

	"github.com/your-org/atom/gate/internal/apierr"
	"github.com/your-org/atom/gate/internal/auth"
)

const (
	defaultAgentRPS    = 100
	defaultExternalRPS = 10
	windowSeconds      = 1
)

// Middleware returns a sliding-window rate limiter keyed by JWT subject.
func Middleware(rdb *redis.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		claims, ok := auth.GetClaims(c)
		if !ok {
			// No claims means JWT middleware already rejected — skip.
			return c.Next()
		}

		limit := defaultExternalRPS
		if claims.Type == "agent" {
			limit = defaultAgentRPS
		}

		now := time.Now()
		windowStart := now.Add(-time.Duration(windowSeconds) * time.Second)
		key := fmt.Sprintf("rl:%s", claims.Subject)

		count, err := slidingWindowCount(c.Context(), rdb, key, windowStart, now, limit)
		if err != nil {
			// Rate limit errors are non-fatal; allow request through.
			return c.Next()
		}

		if count > int64(limit) {
			slog.Warn("rate limit exceeded",
				"subject", claims.Subject,
				"token_type", claims.Type,
				"count", count,
				"limit", limit,
				"path", c.Path())
			c.Set("Retry-After", strconv.Itoa(windowSeconds))
			return c.Status(fiber.StatusTooManyRequests).JSON(
				apierr.LiteLLM(
					"Rate limit exceeded. Please retry after "+strconv.Itoa(windowSeconds)+" second.",
					"RateLimitError",
					"rate_limit_exceeded",
				),
			)
		}
		return c.Next()
	}
}

// slidingWindowCount uses a Redis sorted set (score = unix ns timestamp) to
// implement a sliding window counter. Returns the count AFTER adding this request.
func slidingWindowCount(
	ctx context.Context,
	rdb *redis.Client,
	key string,
	windowStart, now time.Time,
	_ int, // limit unused here; caller decides
) (int64, error) {
	nowNs := strconv.FormatInt(now.UnixNano(), 10)

	pipe := rdb.Pipeline()
	// Remove entries outside the window
	pipe.ZRemRangeByScore(ctx, key, "0", strconv.FormatInt(windowStart.UnixNano(), 10))
	// Add current request
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(now.UnixNano()), Member: nowNs})
	// Count entries in window
	countCmd := pipe.ZCount(ctx, key, strconv.FormatInt(windowStart.UnixNano(), 10), "+inf")
	// Auto-expire the key after the window
	pipe.Expire(ctx, key, 2*time.Duration(windowSeconds)*time.Second)

	if _, err := pipe.Exec(ctx); err != nil {
		return 0, fmt.Errorf("redis pipeline: %w", err)
	}
	return countCmd.Val(), nil
}
