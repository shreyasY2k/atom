"""observability.py — OTEL tracing, Prometheus /metrics, JSON logging for mock services."""

import logging
import os
import time
from typing import Any

from fastapi import FastAPI, Request
from starlette.types import ASGIApp, Receive, Scope, Send

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME as _RES_SVC
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

from prometheus_fastapi_instrumentator import Instrumentator
from pythonjsonlogger import jsonlogger

_svc: str = "mock"


class _JsonFormatter(jsonlogger.JsonFormatter):
    def add_fields(
        self, log_record: dict, record: logging.LogRecord, message_dict: dict
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record["timestamp"] = log_record.pop("asctime", None)
        log_record["level"] = log_record.pop("levelname", record.levelname)
        log_record["logger"] = log_record.pop("name", record.name)
        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx and ctx.is_valid:
            log_record["trace_id"] = format(ctx.trace_id, "032x")
            log_record["span_id"] = format(ctx.span_id, "016x")
        else:
            log_record["trace_id"] = "0" * 32
            log_record["span_id"] = "0" * 16
        log_record["service"] = _svc


class _AccessLog:
    """Pure ASGI access-log middleware — sits inside OTEL so span context is active."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._log = logging.getLogger("http.access")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        t0 = time.perf_counter()
        self._log.info(
            "http.request",
            extra={"http.method": request.method, "http.path": request.url.path},
        )

        status_code = 0

        async def _send(message: Any) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        await self.app(scope, receive, _send)

        self._log.info(
            "http.response",
            extra={
                "http.method": request.method,
                "http.path": request.url.path,
                "http.status": status_code,
                "http.duration_ms": round((time.perf_counter() - t0) * 1000, 2),
            },
        )


def setup(app: FastAPI, service_name: str) -> None:
    """Bootstrap OTEL tracing, Prometheus /metrics, and JSON logging."""
    global _svc
    _svc = service_name

    handler = logging.StreamHandler()
    handler.setFormatter(
        _JsonFormatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    endpoint = os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318"
    )
    resource = Resource.create({_RES_SVC: service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(provider)

    # LIFO: _AccessLog first (innermost), OTEL wraps it (creates span), Prometheus outermost.
    # Pure ASGI class avoids BaseHTTPMiddleware's contextvars-propagation bug.
    app.add_middleware(_AccessLog)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    Instrumentator().instrument(app).expose(
        app, endpoint="/metrics", include_in_schema=False
    )

    logging.getLogger(__name__).info(
        "observability ready", extra={"service": service_name}
    )
