"""
atom-studio backend — FastAPI management portal for ATOM.
Run locally:
  uvicorn atom_studio.main:app --reload --port 3001
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .agents.router import global_router as agents_global_router
from .agents.router import router as agents_router
from .audit.router import router as audit_router
from .runs.router import router as runs_router
from .runs.router import trpc_router
from .auth.router import router as auth_router
from .auth.users_router import router as users_router
from .database import init_pool
from .deployments.router import router as deployments_router
from .deployments.router import runtime_router
from .domains.router import router as domains_router
from .hitl.router import router as hitl_router
from .hitl.service import expire_stale_hitl
from .kafka_producer import init_producer, stop_producer
from .skills.router import router as skills_router
from .tools.router import router as tools_router
from .ws.log_broadcaster import broadcaster
from .ws.router import ws_router

logger = logging.getLogger(__name__)


def _setup_otel(app: FastAPI) -> None:
    """Wire OTEL tracing + JSON logging with trace_id if OTEL_EXPORTER_OTLP_ENDPOINT is set."""
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
    if not endpoint:
        return
    try:
        import json  # noqa: PLC0415
        from opentelemetry import trace  # noqa: PLC0415
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # noqa: PLC0415
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor  # noqa: PLC0415
        from opentelemetry.sdk.resources import Resource  # noqa: PLC0415
        from opentelemetry.sdk.trace import TracerProvider  # noqa: PLC0415
        from opentelemetry.sdk.trace.export import BatchSpanProcessor  # noqa: PLC0415
        from opentelemetry.semconv.resource import ResourceAttributes  # noqa: PLC0415

        service_name = os.environ.get("OTEL_SERVICE_NAME", "atom-studio")
        resource = Resource.create({ResourceAttributes.SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)
        exporter = OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)

        # JSON log formatter that injects trace_id so Alloy regex picks it up
        # and Grafana can link Loki log lines → Tempo traces.
        class _JsonFmt(logging.Formatter):
            def format(self, record: logging.LogRecord) -> str:
                try:
                    ctx = trace.get_current_span().get_span_context()
                    tid = format(ctx.trace_id, "032x") if ctx and ctx.is_valid else ""
                except Exception:
                    tid = ""
                obj: dict = {
                    "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
                    "level": record.levelname,
                    "logger": record.name,
                    "msg": record.getMessage(),
                    "service": service_name,
                }
                if tid:
                    obj["trace_id"] = tid
                if record.exc_info:
                    obj["error"] = self.formatException(record.exc_info)[:1000]
                return json.dumps(obj)

        handler = logging.StreamHandler()
        handler.setFormatter(_JsonFmt())
        logging.root.handlers = [handler]
        logging.root.setLevel(logging.INFO)

        logger.info("OTEL tracing enabled → %s (service=%s)", endpoint, service_name)
    except ImportError:
        logger.warning("opentelemetry packages not installed — OTEL tracing disabled")
    except Exception as exc:
        logger.warning("OTEL setup failed (%s) — tracing disabled", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_pool()
    await init_producer()
    await broadcaster.start()
    task = asyncio.create_task(expire_stale_hitl())
    yield
    task.cancel()
    await broadcaster.stop()
    await stop_producer()


app = FastAPI(title="ATOM Studio API", version="0.1.0", lifespan=lifespan)

_setup_otel(app)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(domains_router, prefix="/api/domains", tags=["domains"])
app.include_router(agents_global_router, prefix="/api/agents", tags=["agents"])
app.include_router(agents_router, prefix="/api/domains/{domain_id}/agents", tags=["agents"])
app.include_router(tools_router, prefix="/api/tools", tags=["tools"])
app.include_router(skills_router, prefix="/api/skills", tags=["skills"])
app.include_router(hitl_router, prefix="/api/hitl", tags=["hitl"])
app.include_router(deployments_router, prefix="/api/deployments", tags=["deployments"])
app.include_router(runtime_router, prefix="/api/runtime", tags=["runtime"])
app.include_router(audit_router, prefix="/api/audit", tags=["audit"])
app.include_router(runs_router, prefix="/api/agents/{agent_id}/runs", tags=["runs"])
# tRPC-compatible endpoints — agentscope agents connect with studio_url=<atom-studio-url>
app.include_router(trpc_router, tags=["trpc"])
app.include_router(ws_router, prefix="/ws")


@app.get("/healthz")
async def health():
    return {"status": "ok"}
