"""Observability: OTEL tracing, Prometheus /metrics, structured JSON logging."""

import logging
import os
import time
from typing import Any, Callable

from fastapi import FastAPI, Request
from starlette.types import ASGIApp, Receive, Scope, Send

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource, SERVICE_NAME as _RES_SVC
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

from prometheus_fastapi_instrumentator import Instrumentator
from pythonjsonlogger import jsonlogger

_svc: str = "builder-backend"


class _JsonFormatter(jsonlogger.JsonFormatter):
    """JSON log formatter that injects trace_id, span_id and service into every record."""

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


def _setup_logging(service_name: str) -> None:
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
    for noisy in ("uvicorn.access", "httpx", "httpcore", "temporalio", "docker"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def _setup_tracing(service_name: str) -> TracerProvider:
    endpoint = os.environ.get(
        "OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318"
    )
    resource = Resource.create({_RES_SVC: service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces"))
    )
    trace.set_tracer_provider(provider)
    HTTPXClientInstrumentor().instrument()
    return provider


class _AccessLog:
    """Pure ASGI access-log middleware.

    Must sit INSIDE the OTEL middleware so that trace.get_current_span() returns
    the active span when we emit each log line.  In Starlette's LIFO stack this
    means we call app.add_middleware(_AccessLog) BEFORE
    FastAPIInstrumentor.instrument_app().
    """

    def __init__(self, app: ASGIApp, service_name: str = "") -> None:
        self.app = app
        self._log = logging.getLogger(f"{service_name}.http")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        t0 = time.perf_counter()

        self._log.info(
            "http.request",
            extra={
                "http.method": request.method,
                "http.path": request.url.path,
                "http.query": str(request.url.query) or None,
                "http.client_ip": request.client.host if request.client else None,
            },
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


def setup(app: FastAPI, service_name: str = "builder-backend") -> None:
    """Bootstrap OTEL tracing, Prometheus /metrics, and JSON logging for FastAPI."""
    _setup_logging(service_name)
    provider = _setup_tracing(service_name)

    # Starlette middleware is LIFO: last add_middleware call = outermost (runs first).
    # Required chain: Prometheus → OTEL (create span) → _AccessLog (read span) → handler
    # So: add _AccessLog first (innermost), OTEL second, Prometheus last (outermost).
    # _AccessLog is a pure ASGI class (not BaseHTTPMiddleware) to avoid the
    # BaseHTTPMiddleware contextvars-propagation bug that breaks OTEL span injection.
    app.add_middleware(_AccessLog, service_name=service_name)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    Instrumentator().instrument(app).expose(
        app, endpoint="/metrics", include_in_schema=False
    )

    logging.getLogger(__name__).info(
        "observability ready",
        extra={
            "service": service_name,
            "otel_endpoint": os.environ.get(
                "OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4318"
            ),
        },
    )
