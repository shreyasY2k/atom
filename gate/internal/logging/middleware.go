package logging

import (
	"log/slog"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/your-org/atom/gate/internal/auth"
	"github.com/your-org/atom/gate/internal/policy"
)

// Middleware emits one structured access-log line per request after it completes.
// It runs last in the chain so it can capture the final status code and total latency.
func Middleware() fiber.Handler {
	return func(c fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		lat := time.Since(start)

		status := c.Response().StatusCode()
		level := slog.LevelInfo
		if status >= 500 {
			level = slog.LevelError
		} else if status >= 400 {
			level = slog.LevelWarn
		}

		attrs := []any{
			"method", c.Method(),
			"path", c.Path(),
			"status", status,
			"latency_ms", lat.Milliseconds(),
			"remote_ip", c.IP(),
			"request_id", c.GetRespHeader("X-Request-Id"),
		}

		if claims, ok := auth.GetClaims(c); ok {
			attrs = append(attrs,
				"token_type", claims.Type,
				"agent_id", claims.AgentID,
				"domain_id", claims.DomainID,
			)
		}

		if pd := policy.GetPolicyDecision(c); pd != nil {
			attrs = append(attrs, "opa_allow", pd.Allow)
			if !pd.Allow {
				attrs = append(attrs, "opa_reason", pd.Reason)
			}
		}

		if ua := c.Get("User-Agent"); ua != "" {
			attrs = append(attrs, "user_agent", ua)
		}

		slog.Log(c.Context(), level, "request", attrs...)
		return err
	}
}
