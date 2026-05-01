package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/your-org/atom/gate/internal/audit"
	"github.com/your-org/atom/gate/internal/auth"
	"github.com/your-org/atom/gate/internal/config"
	"github.com/your-org/atom/gate/internal/health"
	"github.com/your-org/atom/gate/internal/policy"
	"github.com/your-org/atom/gate/internal/ratelimit"
	"github.com/your-org/atom/gate/internal/router"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("config load", "err", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// ── Postgres ──────────────────────────────────────────────────────────────
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("postgres connect", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		slog.Error("postgres ping", "err", err)
		os.Exit(1)
	}
	slog.Info("postgres connected")

	// ── Redis ─────────────────────────────────────────────────────────────────
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("redis URL parse", "err", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(redisOpts)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Error("redis ping", "err", err)
		os.Exit(1)
	}
	slog.Info("redis connected")

	// ── OTEL ──────────────────────────────────────────────────────────────────
	var tp *sdktrace.TracerProvider
	if cfg.OTELEndpoint != "" {
		tp, err = setupOTEL(ctx, cfg.OTELEndpoint)
		if err != nil {
			slog.Warn("OTEL setup failed — tracing disabled", "err", err)
		} else {
			defer func() {
				_ = tp.Shutdown(context.Background())
			}()
		}
	}

	// ── OPA policy manager ────────────────────────────────────────────────────
	opaMgr, err := policy.NewManager(ctx, cfg.OPABundlePath)
	if err != nil {
		slog.Warn("OPA policy load failed — policy enforcement disabled", "err", err)
		opaMgr = nil
	} else {
		defer opaMgr.Close()
		slog.Info("OPA policies loaded", "dir", cfg.OPABundlePath)
	}

	// ── Audit logger ──────────────────────────────────────────────────────────
	auditLogger := audit.New(pool, cfg.PlatformHMACSecret, cfg.KafkaBrokers)
	defer auditLogger.Close()

	// ── Fiber app ─────────────────────────────────────────────────────────────
	app := fiber.New(fiber.Config{
		ErrorHandler: errorHandler,
	})

	// Health endpoints bypass the auth + OPA middleware chain.
	app.Get("/healthz", health.Healthz)
	app.Get("/readyz", health.Readyz(pool, rdb))

	// CORS — allow Studio UI and local dev frontends to call GATE directly.
	app.Use(cors.New(cors.Config{
		AllowOriginsFunc: func(origin string) bool {
			return strings.HasSuffix(origin, ".atom.local") ||
				origin == "http://localhost:3000" ||
				origin == "http://localhost:5173"
		},
		AllowHeaders: []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	}))

	// Middleware chain applied to all other routes.
	app.Use(requestid.New())
	app.Use(otelMiddleware(tp))
	app.Use(auth.Middleware(cfg.JWTPublicKey, pool, rdb))
	if opaMgr != nil {
		app.Use(policy.Middleware(opaMgr, pool, rdb))
	}
	app.Use(ratelimit.Middleware(rdb))
	app.Use(auditLogger.Middleware())

	// Agent proxy routes (specific routes registered before wildcard)
	router.Mount(app, cfg, pool, rdb)

	// ── Start ─────────────────────────────────────────────────────────────────
	addr := fmt.Sprintf(":%s", cfg.GatePort)
	slog.Info("GATE starting", "addr", addr)

	errCh := make(chan error, 1)
	go func() { errCh <- app.Listen(addr) }()

	select {
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	case err := <-errCh:
		slog.Error("server error", "err", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := app.ShutdownWithContext(shutdownCtx); err != nil {
		slog.Error("graceful shutdown", "err", err)
	}
}

func errorHandler(c fiber.Ctx, err error) error {
	code := fiber.StatusInternalServerError
	var fe *fiber.Error
	if errors.As(err, &fe) {
		code = fe.Code
	}
	return c.Status(code).JSON(fiber.Map{"error": err.Error()})
}

// otelMiddleware adds a trace span per request when a TracerProvider is configured.
func otelMiddleware(tp *sdktrace.TracerProvider) fiber.Handler {
	return func(c fiber.Ctx) error {
		if tp == nil {
			return c.Next()
		}
		tracer := otel.Tracer("gate")
		_, span := tracer.Start(c.Context(), c.Route().Path,
			trace.WithSpanKind(trace.SpanKindServer))
		defer span.End()

		err := c.Next()

		if claims, ok := auth.GetClaims(c); ok {
			span.SetAttributes(
				attribute.String("atom.token_type", claims.Type),
				attribute.String("atom.domain_id", claims.DomainID),
				attribute.String("atom.agent_id", claims.AgentID),
			)
		}
		span.SetAttributes(
			attribute.Int("http.status_code", c.Response().StatusCode()),
			attribute.String("http.method", c.Method()),
		)
		return err
	}
}

func setupOTEL(ctx context.Context, endpoint string) (*sdktrace.TracerProvider, error) {
	// otlptracehttp.WithEndpoint expects "host:port" with no scheme.
	// Strip http:// or https:// so a full URL in OTEL_EXPORTER_OTLP_ENDPOINT
	// doesn't produce the "http://http://..." double-prefix error.
	endpoint = strings.TrimPrefix(endpoint, "https://")
	endpoint = strings.TrimPrefix(endpoint, "http://")
	exp, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpoint(endpoint),
		otlptracehttp.WithInsecure(),
	)
	if err != nil {
		return nil, fmt.Errorf("create OTLP exporter: %w", err)
	}
	res, err := resource.New(ctx,
		resource.WithAttributes(semconv.ServiceName("gate")),
	)
	if err != nil {
		return nil, fmt.Errorf("create OTEL resource: %w", err)
	}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(res),
	)
	otel.SetTracerProvider(tp)
	return tp, nil
}
