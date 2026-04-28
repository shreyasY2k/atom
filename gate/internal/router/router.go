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
	"github.com/your-org/atom/gate/internal/config"
)

const (
	serviceNameCacheTTL = 60 * time.Second
	serviceNameCacheKey = "agent:svc:"
)

// Mount registers all agent-scoped proxy routes on the Fiber app.
// Routes are registered specific-first so Fiber's top-down matching
// sends /v1/* to atom-llm, /hitl/* to atom-studio, /memory/* to
// atom-memory, and everything else to the agent pod.
func Mount(app *fiber.App, cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client) {
	client := &fasthttp.Client{
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	base := "/domain/:domain_id/agent/:agent_id"

	// 1. LLM calls → atom-llm  (/v1/* → atom-llm:4000/v1/*)
	app.All(base+"/v1/*", staticProxy(client, cfg.AtomLLMURL, "/v1/"))

	// 2. HITL calls → atom-studio-api  (/hitl/* → atom-studio-api:3001/api/hitl/*)
	app.All(base+"/hitl/*", staticProxy(client, cfg.AtomStudioURL, "/api/hitl/"))

	// 3. Memory calls → atom-memory  (/memory/* → atom-memory:8000/memory/*)
	app.All(base+"/memory/*", staticProxy(client, cfg.AtomMemoryURL, "/memory/"))

	// 4. Everything else → agent pod (resolved from Postgres + Redis cache)
	app.All(base+"/*", agentProxy(client, pool, rdb))
}

// staticProxy forwards to a fixed upstream URL, rewriting the path prefix.
// upstreamBase must include trailing slash, e.g. "/v1/".
func staticProxy(client *fasthttp.Client, upstreamRoot, upstreamBase string) fiber.Handler {
	return func(c fiber.Ctx) error {
		domainID := c.Params("domain_id")
		agentID := c.Params("agent_id")

		splat := c.Params("*")
		if !strings.HasPrefix(splat, "/") {
			splat = "/" + splat
		}
		targetURL := strings.TrimRight(upstreamRoot, "/") + upstreamBase + strings.TrimPrefix(splat, "/")
		if qs := string(c.Request().URI().QueryString()); qs != "" {
			targetURL += "?" + qs
		}

		return forward(c, client, targetURL, domainID, agentID)
	}
}

// agentProxy resolves the agent pod's cluster service name from Postgres
// (Redis-cached) and proxies the request, preserving the original path.
func agentProxy(client *fasthttp.Client, pool *pgxpool.Pool, rdb *redis.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		domainID := c.Params("domain_id")
		agentID := c.Params("agent_id")

		// Reject cross-domain agent tokens at the router layer too.
		if claims, ok := auth.GetClaims(c); ok && claims.Type == "agent" && claims.DomainID != domainID {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "domain_mismatch"})
		}

		svcName, err := resolveServiceName(c.Context(), agentID, pool, rdb)
		if err != nil {
			slog.Error("resolve service name", "agent_id", agentID, "err", err)
			return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "agent_not_found"})
		}

		splat := c.Params("*")
		if !strings.HasPrefix(splat, "/") {
			splat = "/" + splat
		}
		targetURL := fmt.Sprintf("http://%s%s", svcName, splat)
		if qs := string(c.Request().URI().QueryString()); qs != "" {
			targetURL += "?" + qs
		}

		return forward(c, client, targetURL, domainID, agentID)
	}
}

// forward copies the inbound request to targetURL, injects ATOM identity
// headers, executes the upstream call, and streams the response back.
func forward(c fiber.Ctx, client *fasthttp.Client, targetURL, domainID, agentID string) error {
	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	c.Request().CopyTo(req)
	req.SetRequestURI(targetURL)
	req.Header.Set("X-ATOM-Domain-ID", domainID)
	req.Header.Set("X-ATOM-Agent-ID", agentID)

	if err := client.Do(req, resp); err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "upstream_unavailable"})
	}

	resp.Header.CopyTo(&c.Response().Header)
	c.Response().SetStatusCode(resp.StatusCode())
	c.Response().SetBody(resp.Body())
	return nil
}

// resolveServiceName returns the k8s cluster service name for the given agent.
// Redis-cached for serviceNameCacheTTL seconds.
func resolveServiceName(ctx context.Context, agentID string, pool *pgxpool.Pool, rdb *redis.Client) (string, error) {
	key := serviceNameCacheKey + agentID

	if cached, err := rdb.Get(ctx, key).Result(); err == nil {
		return cached, nil
	}

	var svcName string
	if err := pool.QueryRow(ctx,
		`SELECT cluster_service_name FROM agents WHERE id = $1 AND status = 'deployed'`,
		agentID).Scan(&svcName); err != nil {
		return "", fmt.Errorf("agent %s not deployed: %w", agentID, err)
	}
	if svcName == "" {
		return "", fmt.Errorf("agent %s has no service name", agentID)
	}

	_ = rdb.Set(ctx, key, svcName, serviceNameCacheTTL)
	return svcName, nil
}
