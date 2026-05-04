package policy

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/your-org/atom/gate/internal/apierr"
	"github.com/your-org/atom/gate/internal/auth"
)

const (
	policyDecisionKey = "policy_decision"
	agentMetaCacheKey = "agent:meta:"
	agentMetaTTL      = 60 * time.Second
)

// PolicyDecision is stored in c.Locals so the audit middleware can log it.
type PolicyDecision struct {
	Allow  bool   `json:"allow"`
	Reason string `json:"reason,omitempty"`
}

// agentMeta holds the tools and skills provisioned for an agent.
type agentMeta struct {
	Tools  []string
	Skills []string
}

// Middleware returns a Fiber middleware that evaluates the OPA policy for every
// request and returns 403 if the decision is deny.
func Middleware(mgr *Manager, pool *pgxpool.Pool, rdb *redis.Client) fiber.Handler {
	return func(c fiber.Ctx) error {
		claims, _ := auth.GetClaims(c)

		input := buildInput(claims, c)

		// Enrich with agent tools/skills for agent tokens.
		if claims != nil && claims.Type == "agent" && claims.AgentID != "" {
			meta, err := fetchAgentMeta(c.Context(), claims.AgentID, pool, rdb)
			if err != nil {
				slog.Warn("fetch agent meta for OPA", "agent_id", claims.AgentID, "err", err)
			} else {
				input["agent"] = map[string]any{
					"tools":  meta.Tools,
					"skills": meta.Skills,
				}
			}
		}

		decision, err := mgr.Eval(c.Context(), input)
		if err != nil {
			slog.Error("OPA eval error", "err", err)
			decision = Decision{Allow: true, Reason: "eval_error"}
		}

		// Persist decision for audit middleware.
		c.Locals(policyDecisionKey, &PolicyDecision{
			Allow:  decision.Allow,
			Reason: decision.Reason,
		})

		if !decision.Allow {
			msg := "Request blocked by policy"
			if decision.Reason != "" {
				msg += ": " + decision.Reason
			}
			return c.Status(fiber.StatusForbidden).JSON(
				apierr.LiteLLM(msg, "PermissionDeniedError", "policy_violation"),
			)
		}
		return c.Next()
	}
}

// GetPolicyDecision retrieves the OPA decision stored by the middleware.
func GetPolicyDecision(c fiber.Ctx) *PolicyDecision {
	v := c.Locals(policyDecisionKey)
	if v == nil {
		return nil
	}
	pd, _ := v.(*PolicyDecision)
	return pd
}

func buildInput(claims *auth.Claims, c fiber.Ctx) map[string]any {
	tokenInput := map[string]any{
		"revoked": false,
	}
	if claims != nil {
		tokenInput["sub"] = claims.Subject
		tokenInput["type"] = claims.Type
		tokenInput["role"] = claims.Role
		tokenInput["domain_id"] = claims.DomainID
		tokenInput["agent_id"] = claims.AgentID
	}

	// Build headers map (exclude Authorization to avoid logging the raw JWT).
	headers := map[string]string{}
	c.Request().Header.VisitAll(func(k, v []byte) {
		key := string(k)
		if !strings.EqualFold(key, "authorization") {
			headers[key] = string(v)
		}
	})

	return map[string]any{
		"token": tokenInput,
		"request": map[string]any{
			"method":  c.Method(),
			"path":    c.Path(),
			"headers": headers,
		},
		"agent": map[string]any{
			"tools":  []string{},
			"skills": []string{},
		},
	}
}

// fetchAgentMeta returns tools and skills for the given agent (Redis-cached).
func fetchAgentMeta(ctx context.Context, agentID string, pool *pgxpool.Pool, rdb *redis.Client) (*agentMeta, error) {
	key := agentMetaCacheKey + agentID

	// Try Redis cache.
	if cached, err := rdb.HGetAll(ctx, key).Result(); err == nil && len(cached) > 0 {
		tools := splitCSV(cached["tools"])
		skills := splitCSV(cached["skills"])
		return &agentMeta{Tools: tools, Skills: skills}, nil
	}

	// Postgres fallback.
	tools, err := queryStringList(ctx, pool,
		`SELECT t.name FROM tools t
		 JOIN agent_tools at ON at.tool_id = t.id
		 WHERE at.agent_id = $1`, agentID)
	if err != nil {
		return nil, fmt.Errorf("query tools: %w", err)
	}
	skills, err := queryStringList(ctx, pool,
		`SELECT s.name FROM skills s
		 JOIN agent_skills ask ON ask.skill_id = s.id
		 WHERE ask.agent_id = $1`, agentID)
	if err != nil {
		return nil, fmt.Errorf("query skills: %w", err)
	}

	// Cache in Redis.
	_ = rdb.HSet(ctx, key, map[string]any{
		"tools":  strings.Join(tools, ","),
		"skills": strings.Join(skills, ","),
	})
	_ = rdb.Expire(ctx, key, agentMetaTTL)

	return &agentMeta{Tools: tools, Skills: skills}, nil
}

func queryStringList(ctx context.Context, pool *pgxpool.Pool, query, arg string) ([]string, error) {
	rows, err := pool.Query(ctx, query, arg)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		result = append(result, name)
	}
	return result, nil
}

func splitCSV(s string) []string {
	if s == "" {
		return []string{}
	}
	return strings.Split(s, ",")
}
