"""
atom-llm entry point.

Starts the LiteLLM proxy server and mounts ATOM-specific extension routers.
No source patching — extensions are registered via FastAPI include_router()
before uvicorn starts, so all routes are available from the first request.

Config loading: LiteLLM reads CONFIG_FILE_PATH (or WORKER_CONFIG) env var
during its lifespan startup event. Set CONFIG_FILE_PATH to the YAML path.
"""

import json
import logging
import os

from dotenv import load_dotenv

load_dotenv()

# Must be set before importing the proxy app so the lifespan startup event
# sees it when it calls proxy_config.load_config().
os.environ.setdefault("CONFIG_FILE_PATH", "/app/config.dev.yaml")

from litellm.proxy.proxy_server import app  # noqa: E402

from atom_extensions.provision import router as provision_router  # noqa: E402
from atom_extensions.tools_skills import atom_tools_router  # noqa: E402

# Mount ATOM routers — must happen before uvicorn starts.
app.include_router(provision_router)
app.include_router(atom_tools_router)

# ── JSON logging with trace_id ────────────────────────────────────────────────
# Outputs structured JSON so Alloy's regex '"trace_id":"(\w+)"' can extract
# trace IDs and Grafana can link Loki log lines → Tempo traces.


def _get_trace_id() -> str:
    try:
        from opentelemetry import trace  # noqa: PLC0415

        ctx = trace.get_current_span().get_span_context()
        return format(ctx.trace_id, "032x") if ctx and ctx.is_valid else ""
    except Exception:
        return ""


class _AtomJsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        obj: dict = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "service": "atom-llm",
        }
        tid = _get_trace_id()
        if tid:
            obj["trace_id"] = tid
        if record.exc_info:
            obj["error"] = self.formatException(record.exc_info)[:1000]
        return json.dumps(obj)


_handler = logging.StreamHandler()
_handler.setFormatter(_AtomJsonFormatter())
logging.root.handlers = [_handler]
logging.root.setLevel(logging.INFO)

# ── Callbacks ─────────────────────────────────────────────────────────────────

# Register Kafka audit callback if KAFKA_BROKERS is configured.
if os.environ.get("KAFKA_BROKERS"):
    import litellm
    from atom_extensions.kafka_audit import KafkaAuditLogger

    litellm.callbacks.append(KafkaAuditLogger())

# Register OTEL tracing callback if OTEL_EXPORTER_OTLP_ENDPOINT is configured.
if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
    import litellm  # noqa: F811 — safe reimport
    from atom_extensions.otel import OTELLogger

    litellm.callbacks.append(OTELLogger())

# Register Prometheus metrics callback so LiteLLM exposes /metrics.
try:
    import litellm  # noqa: F811
    from litellm.integrations.prometheus import PrometheusLogger

    litellm.callbacks.append(PrometheusLogger())
    logging.getLogger(__name__).info("Prometheus metrics enabled at /metrics")
except Exception as exc:
    logging.getLogger(__name__).warning("Prometheus metrics not available: %s", exc)


def _prisma_push() -> None:
    """Apply LiteLLM's Prisma migrations before the server starts.

    Three scenarios — all data-safe, nothing is ever dropped:

    1. Normal / subsequent run (_prisma_migrations exists):
       prisma migrate deploy applies pending migrations, no-ops if current.

    2. P3005 — existing tables from old db push, no migration history:
       Baseline via `prisma migrate resolve --applied <name>` for every
       migration in migrations/. This is the official Prisma baselining
       workflow (https://pris.ly/d/migrate-baseline). It creates
       _prisma_migrations and marks all 118 migrations as applied without
       touching any table data. Then migrate deploy picks up new ones.

    3. Empty DB (first run / post dev-reset-db):
       migrate deploy creates _prisma_migrations + all LiteLLM tables.

    ATOM tables are always preserved — migrate deploy never drops tables
    that are not in the Prisma schema.
    """
    import glob
    import subprocess
    import sys

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return

    # litellm_proxy_extras ships schema.prisma + migrations/; prefer it.
    try:
        import litellm_proxy_extras as _extras

        extras_dir = os.path.dirname(_extras.__file__)
        schema = os.path.join(extras_dir, "schema.prisma")
        migrations_dir = os.path.join(extras_dir, "migrations")
    except ImportError:
        import litellm as _lt

        extras_dir = os.path.join(os.path.dirname(_lt.__file__), "proxy")
        schema = os.path.join(extras_dir, "schema.prisma")
        migrations_dir = os.path.join(extras_dir, "migrations")

    if not os.path.exists(schema):
        print(
            f"[atom-llm] WARNING: schema.prisma not found at {schema}, skipping",
            flush=True,
        )
        return

    print(f"[atom-llm] running prisma migrate deploy on {schema}", flush=True)
    result = subprocess.run(
        ["prisma", "migrate", "deploy", "--schema", schema],
        check=False,
        capture_output=True,
        text=True,
    )
    print(result.stdout, end="", flush=True)
    if result.returncode == 0:
        return

    # P3005: schema not empty but no _prisma_migrations tracking table.
    # Baseline every existing migration as already applied, then retry.
    if (
        "P3005" in result.stdout
        or "P3005" in result.stderr
        or "not empty" in (result.stderr or "")
    ):
        print(result.stderr or "", end="", flush=True)
        if not os.path.isdir(migrations_dir):
            print(
                "[atom-llm] ERROR: migrations dir not found, cannot baseline",
                flush=True,
            )
            sys.exit(1)

        migration_names = sorted(
            os.path.basename(d)
            for d in glob.glob(os.path.join(migrations_dir, "*"))
            if os.path.isdir(d)
        )
        print(
            f"[atom-llm] P3005 baseline: marking {len(migration_names)} migrations as applied",
            flush=True,
        )

        # Use the first migration to let Prisma create the _prisma_migrations table
        # with the correct schema, then bulk-insert the rest via SQL.
        first, *rest = migration_names
        subprocess.run(
            ["prisma", "migrate", "resolve", "--applied", first, "--schema", schema],
            check=False,
            capture_output=True,
        )

        # Bulk-insert remaining migrations in a single query — much faster than
        # 117 more subprocess calls.
        if rest:
            import asyncio
            import uuid

            import asyncpg

            async def _bulk_insert() -> None:
                conn = await asyncpg.connect(db_url)
                try:
                    await conn.executemany(
                        """
                        INSERT INTO "_prisma_migrations"
                            (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
                        VALUES ($1, '', NOW(), $2, NOW(), 1)
                        ON CONFLICT DO NOTHING
                        """,
                        [(str(uuid.uuid4()), name) for name in rest],
                    )
                finally:
                    await conn.close()

            asyncio.run(_bulk_insert())

        print(
            "[atom-llm] baseline complete — retrying prisma migrate deploy", flush=True
        )
        result2 = subprocess.run(
            ["prisma", "migrate", "deploy", "--schema", schema],
            check=False,
        )
        if result2.returncode != 0:
            print(
                "[atom-llm] prisma migrate deploy failed after baseline — aborting",
                flush=True,
            )
            sys.exit(result2.returncode)
        return

    print(f"[atom-llm] prisma migrate deploy failed:\n{result.stderr}", flush=True)
    sys.exit(result.returncode)


if __name__ == "__main__":
    import uvicorn

    _prisma_push()
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "4000")))
