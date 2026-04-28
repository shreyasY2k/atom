package router

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/valyala/fasthttp"

	"github.com/your-org/atom/gate/internal/auth"
)

const (
	serviceNameCacheTTL = 60 * time.Second
	serviceNameCacheKey = "agent:svc:"
)

// Mount registers the agent proxy route on the given Fiber app.
func Mount(app *fiber.App, pool *pgxpool.Pool, rdb *redis.Client) {
	app.All("/domain/:domain_id/agent/:agent_id/*", proxy(pool, rdb))
}

func proxy(pool *pgxpool.Pool, rdb *redis.Client) fiber.Handler {
	client := &fasthttp.Client{
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	return func(c fiber.Ctx) error {
		domainID := c.Params("domain_id")
		agentID := c.Params("agent_id")

		// Verify the JWT domain_id matches the path domain_id.
		claims, ok := auth.GetClaims(c)
		if ok && claims.Type == "agent" && claims.DomainID != domainID {
			return c.Status(fiber.StatusForbidden).
				JSON(fiber.Map{"error": "domain_mismatch"})
		}

		// Resolve the k8s service name.
		svcName, err := resolveServiceName(c.Context(), agentID, pool, rdb)
		if err != nil {
			slog.Error("resolve service name", "agent_id", agentID, "err", err)
			return c.Status(fiber.StatusBadGateway).
				JSON(fiber.Map{"error": "agent_not_found"})
		}

		// Build the upstream URL.
		// Strip /domain/{id}/agent/{id} prefix; keep the rest.
		tail := c.Params("*")
		if !strings.HasPrefix(tail, "/") {
			tail = "/" + tail
		}
		targetURL := fmt.Sprintf("http://%s%s", svcName, tail)
		if qs := string(c.Request().URI().QueryString()); qs != "" {
			targetURL += "?" + qs
		}

		// Forward to upstream via fasthttp.
		req := fasthttp.AcquireRequest()
		resp := fasthttp.AcquireResponse()
		defer fasthttp.ReleaseRequest(req)
		defer fasthttp.ReleaseResponse(resp)

		c.Request().CopyTo(req)
		req.SetRequestURI(targetURL)
		req.Header.Set("X-ATOM-Domain-ID", domainID)
		req.Header.Set("X-ATOM-Agent-ID", agentID)

		if err := client.Do(req, resp); err != nil {
			return c.Status(fiber.StatusBadGateway).
				JSON(fiber.Map{"error": "upstream_unavailable"})
		}

		resp.Header.CopyTo(&c.Response().Header)
		c.Response().SetStatusCode(resp.StatusCode())
		c.Response().SetBody(resp.Body())
		return nil
	}
}

// resolveServiceName returns the k8s service name for the given agent.
// Redis-cached for serviceNameCacheTTL seconds.
func resolveServiceName(ctx context.Context, agentID string, pool *pgxpool.Pool, rdb *redis.Client) (string, error) {
	key := serviceNameCacheKey + agentID

	cached, err := rdb.Get(ctx, key).Result()
	if err == nil {
		return cached, nil
	}

	var svcName string
	err = pool.QueryRow(ctx,
		`SELECT cluster_service_name FROM agents WHERE id = $1 AND status = 'deployed'`,
		agentID).Scan(&svcName)
	if err != nil {
		return "", fmt.Errorf("agent %s not deployed: %w", agentID, err)
	}
	if svcName == "" {
		return "", fmt.Errorf("agent %s has no service name", agentID)
	}

	_ = rdb.Set(ctx, key, svcName, serviceNameCacheTTL)
	return svcName, nil
}
