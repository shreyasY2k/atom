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
	virtualKeyCacheKey  = "agent:llmkey:"
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
	//    GATE looks up agents.litellm_virtual_key for this agent (Redis-cached).
	//    Falls back to ATOM_LLM_KEY env var if the agent has no key provisioned yet.
	app.All(base+"/v1/*", llmProxy(client, cfg.AtomLLMURL, cfg.AtomLLMKey, pool, rdb))

	// 2. HITL calls → atom-studio-api  (/hitl/* → atom-studio-api:3001/api/hitl/*)
	app.All(base+"/hitl/*", staticProxy(client, cfg.AtomStudioURL, "/api/hitl/", ""))

	// 3. Memory calls → atom-memory  (/memory/* → atom-memory:8000/memory/*)
	app.All(base+"/memory/*", staticProxy(client, cfg.AtomMemoryURL, "/memory/", ""))

	// 4. Everything else → agent pod (resolved from Postgres + Redis cache)
	app.All(base+"/*", agentProxy(client, pool, rdb))
}

// staticProxy forwards to a fixed upstream URL, rewriting the path prefix.
// upstreamBase must include trailing slash, e.g. "/v1/".
// If upstreamKey is non-empty the Authorization header is replaced with
// "Bearer <upstreamKey>" on the upstream request — used for atom-llm so
// that GATE's own service credential is presented, not the agent JWT.
func staticProxy(client *fasthttp.Client, upstreamRoot, upstreamBase, upstreamKey string) fiber.Handler {
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

		return forward(c, client, targetURL, domainID, agentID, upstreamKey)
	}
}

// llmProxy forwards /v1/* to atom-llm, replacing Authorization with the
// agent's LiteLLM virtual key from Postgres (Redis-cached).
// Falls back to fallbackKey (ATOM_LLM_KEY env var) when the agent has no
// virtual key yet — useful before atom-studio has provisioned one.
func llmProxy(client *fasthttp.Client, upstreamRoot, fallbackKey string, pool *pgxpool.Pool, rdb *redis.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		domainID := c.Params("domain_id")
		agentID := c.Params("agent_id")

		splat := c.Params("*")
		if !strings.HasPrefix(splat, "/") {
			splat = "/" + splat
		}
		targetURL := strings.TrimRight(upstreamRoot, "/") + "/v1/" + strings.TrimPrefix(splat, "/")
		if qs := string(c.Request().URI().QueryString()); qs != "" {
			targetURL += "?" + qs
		}

		llmKey, err := resolveVirtualKey(c.Context(), agentID, pool, rdb, fallbackKey)
		if err != nil || llmKey == "" {
			slog.Warn("no LiteLLM virtual key for agent", "agent_id", agentID, "err", err)
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "agent_not_provisioned"})
		}

		return forward(c, client, targetURL, domainID, agentID, llmKey)
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

		return forward(c, client, targetURL, domainID, agentID, "")
	}
}

// forward copies the inbound request to targetURL, injects ATOM identity
// headers, executes the upstream call, and streams the response back.
// If upstreamKey is non-empty the Authorization header is replaced —
// the caller's JWT stays within GATE; the upstream sees only its own key.
func forward(c fiber.Ctx, client *fasthttp.Client, targetURL, domainID, agentID, upstreamKey string) error {
	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	c.Request().CopyTo(req)
	req.SetRequestURI(targetURL)
	req.Header.Set("X-ATOM-Domain-ID", domainID)
	req.Header.Set("X-ATOM-Agent-ID", agentID)
	if upstreamKey != "" {
		req.Header.Set("Authorization", "Bearer "+upstreamKey)
	}

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

// resolveVirtualKey returns the agent's LiteLLM virtual key from Postgres
// (Redis-cached for serviceNameCacheTTL seconds).
// Returns fallback if the agent has no virtual key set.
func resolveVirtualKey(ctx context.Context, agentID string, pool *pgxpool.Pool, rdb *redis.Client, fallback string) (string, error) {
	cacheKey := virtualKeyCacheKey + agentID

	if cached, err := rdb.Get(ctx, cacheKey).Result(); err == nil {
		return cached, nil
	}

	var virtualKey *string
	if err := pool.QueryRow(ctx,
		`SELECT litellm_virtual_key FROM agents WHERE id = $1`,
		agentID).Scan(&virtualKey); err != nil {
		return fallback, nil // agent not found — return fallback, not error
	}

	if virtualKey == nil || *virtualKey == "" {
		return fallback, nil // not provisioned yet
	}

	_ = rdb.Set(ctx, cacheKey, *virtualKey, serviceNameCacheTTL)
	return *virtualKey, nil
}
