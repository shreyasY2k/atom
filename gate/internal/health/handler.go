package health

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

func Healthz(c fiber.Ctx) error {
	return c.JSON(fiber.Map{"status": "ok"})
}

// Readyz checks live Postgres + Redis connectivity.
func Readyz(pool *pgxpool.Pool, rdb *redis.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
		defer cancel()

		if err := pool.Ping(ctx); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).
				JSON(fiber.Map{"status": "unhealthy", "component": "postgres", "error": err.Error()})
		}
		if err := rdb.Ping(ctx).Err(); err != nil {
			return c.Status(fiber.StatusServiceUnavailable).
				JSON(fiber.Map{"status": "unhealthy", "component": "redis", "error": err.Error()})
		}
		return c.JSON(fiber.Map{"status": "ok"})
	}
}
