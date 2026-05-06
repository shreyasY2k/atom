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

    Uses `prisma migrate deploy` (via litellm_proxy_extras) rather than
    `prisma db push --accept-data-loss`.  The latter syncs the DB to ONLY
    contain Prisma-managed tables and will silently DROP the ATOM schema
    tables created by golang-migrate (users, domains, agents, …).
    `migrate deploy` only applies pending migrations — it never drops tables
    outside the Prisma schema.

    Only runs when DATABASE_URL is set (skipped in no-DB local mode).
    """
    import subprocess
    import sys

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        return

    # Prefer litellm_proxy_extras which ships a proper migrations/ directory.
    try:
        import litellm_proxy_extras as _extras

        schema = os.path.join(os.path.dirname(_extras.__file__), "schema.prisma")
    except ImportError:
        import litellm as _lt

        schema = os.path.join(os.path.dirname(_lt.__file__), "proxy", "schema.prisma")

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
    )
    if result.returncode != 0:
        print("[atom-llm] prisma migrate deploy failed — aborting startup", flush=True)
        sys.exit(result.returncode)


if __name__ == "__main__":
    import uvicorn

    _prisma_push()
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "4000")))
