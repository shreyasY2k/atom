"""
atom_extensions/otel.py

OTELLogger — LiteLLM CustomLogger that creates an OpenTelemetry span for
every LLM call forwarded through atom-llm.

Span attributes per call:
    llm.model          — model name (e.g. "gpt-4o", "gemini-2.5-flash")
    llm.agent_id       — ATOM agent UUID extracted from request metadata
    llm.prompt_tokens  — prompt token count from the response usage object
    llm.completion_tokens — completion token count
    llm.latency_ms     — wall-clock latency in milliseconds
    llm.success        — True / False

Configuration:
    OTEL_EXPORTER_OTLP_ENDPOINT  — e.g. http://alloy.atom-system.svc:4318
    OTEL_SERVICE_NAME            — defaults to "atom-llm"

Register in main.py:
    from atom_extensions.otel import OTELLogger
    litellm.callbacks.append(OTELLogger())
"""

import logging
import os
from datetime import datetime
from typing import Any, Dict

logger = logging.getLogger(__name__)

try:
    from litellm.integrations.custom_logger import CustomLogger as _Base
except ImportError:
    _Base = object  # type: ignore[assignment,misc]


def _ns(dt: datetime) -> int:
    """Convert a datetime to nanoseconds since epoch (OTEL timestamp format)."""
    return int(dt.timestamp() * 1e9)


def _init_tracer():
    """
    Set up a TracerProvider pointing at the OTLP endpoint configured via
    OTEL_EXPORTER_OTLP_ENDPOINT.  Returns a tracer or None if OTEL is not
    configured / packages are missing.
    """
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", "").rstrip("/")
    if not endpoint:
        logger.info("OTELLogger: OTEL_EXPORTER_OTLP_ENDPOINT not set — tracing disabled")
        return None

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
        from opentelemetry.semconv.resource import ResourceAttributes

        service_name = os.environ.get("OTEL_SERVICE_NAME", "atom-llm")
        resource = Resource.create({ResourceAttributes.SERVICE_NAME: service_name})
        provider = TracerProvider(resource=resource)

        exporter = OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces")
        provider.add_span_processor(BatchSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        tracer = trace.get_tracer("atom-llm")
        logger.info("OTELLogger: tracing enabled → %s", endpoint)
        return tracer

    except ImportError as exc:
        logger.warning("OTELLogger: opentelemetry packages not installed (%s) — disabled", exc)
        return None
    except Exception as exc:
        logger.warning("OTELLogger: TracerProvider init failed (%s) — disabled", exc)
        return None


class OTELLogger(_Base):  # type: ignore[misc]
    """
    LiteLLM CustomLogger that emits an OpenTelemetry span for every LLM call.

    Span timing matches the actual call duration (start_time → end_time from
    the LiteLLM callback).  Attributes expose model, agent, and token data so
    Grafana dashboards can aggregate per-agent token spend.
    """

    def __init__(self) -> None:
        self._tracer = _init_tracer()

    # ── LiteLLM hooks ─────────────────────────────────────────────────────────

    def log_success_event(self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime) -> None:
        self._emit(kwargs, response_obj, start_time, end_time, success=True)

    def log_failure_event(self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime) -> None:
        self._emit(kwargs, response_obj, start_time, end_time, success=False)

    async def async_log_success_event(
        self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime
    ) -> None:
        self.log_success_event(kwargs, response_obj, start_time, end_time)

    async def async_log_failure_event(
        self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime
    ) -> None:
        self.log_failure_event(kwargs, response_obj, start_time, end_time)

    # ── Internal ──────────────────────────────────────────────────────────────

    def _emit(
        self,
        kwargs: Dict,
        response_obj: Any,
        start_time: datetime,
        end_time: datetime,
        success: bool,
    ) -> None:
        if self._tracer is None:
            return

        try:
            from opentelemetry.trace import StatusCode

            latency_ms = int((end_time - start_time).total_seconds() * 1000)
            usage = getattr(response_obj, "usage", None) if response_obj else None
            metadata = kwargs.get("litellm_params", {}).get("metadata", {}) or {}
            agent_id = metadata.get("atom_agent_id") or metadata.get("agent_id") or "unknown"

            # Create a span with the actual call start/end timestamps.
            span = self._tracer.start_span(
                "llm.call",
                start_time=_ns(start_time),
            )
            span.set_attribute("llm.model", kwargs.get("model", "unknown"))
            span.set_attribute("llm.agent_id", agent_id)
            span.set_attribute(
                "llm.prompt_tokens",
                getattr(usage, "prompt_tokens", 0) if usage else 0,
            )
            span.set_attribute(
                "llm.completion_tokens",
                getattr(usage, "completion_tokens", 0) if usage else 0,
            )
            span.set_attribute("llm.latency_ms", latency_ms)
            span.set_attribute("llm.success", success)

            if not success:
                span.set_status(StatusCode.ERROR)

            span.end(end_time=_ns(end_time))

        except Exception as exc:
            logger.debug("OTELLogger: span emit failed: %s", exc)
