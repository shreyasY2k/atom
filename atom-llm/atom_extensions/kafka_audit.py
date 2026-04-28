"""
atom_extensions/kafka_audit.py

KafkaAuditLogger — LiteLLM CustomLogger that produces every LLM call event
to the Kafka topic "atom.llm" for BFSI audit archival.

Configure by adding this class to LiteLLM's callback list:
    litellm.callbacks = [KafkaAuditLogger()]

Or via the startup hook (see startup_hook.py).

Event schema:
    {
        "timestamp": "ISO-8601",
        "agent_id": "uuid or null",
        "model": "gpt-4o",
        "prompt_tokens": 150,
        "completion_tokens": 80,
        "latency_ms": 1240,
        "success": true
    }
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

KAFKA_TOPIC = "atom.llm"


try:
    from litellm.integrations.custom_logger import CustomLogger as _Base
except ImportError:
    _Base = object  # type: ignore[assignment,misc]


class KafkaAuditLogger(_Base):  # type: ignore[misc]
    """
    Subclasses LiteLLM's CustomLogger to inherit default no-op implementations
    for all hooks LiteLLM may call (async_post_call_success_hook, etc.).
    We only override the success/failure log methods to produce to Kafka.
    """

    def __init__(self) -> None:
        self._producer: Optional[Any] = None
        self._brokers = os.environ.get("KAFKA_BROKERS", "")
        if self._brokers:
            self._init_producer()
        else:
            logger.warning("KafkaAuditLogger: KAFKA_BROKERS not set — audit events will not be produced")

    def _init_producer(self) -> None:
        try:
            from confluent_kafka import Producer

            self._producer = Producer({"bootstrap.servers": self._brokers})
            logger.info("KafkaAuditLogger: connected to %s", self._brokers)
        except ImportError:
            logger.warning("KafkaAuditLogger: confluent-kafka not installed — " "falling back to kafka-python")
            self._init_producer_fallback()
        except Exception as exc:
            logger.error("KafkaAuditLogger: producer init failed: %s", exc)

    def _init_producer_fallback(self) -> None:
        try:
            from kafka import KafkaProducer

            self._producer = _KafkaPythonWrapper(
                KafkaProducer(
                    bootstrap_servers=self._brokers.split(","),
                    value_serializer=lambda v: json.dumps(v).encode(),
                )
            )
        except Exception as exc:
            logger.error("KafkaAuditLogger: fallback kafka-python init failed: %s", exc)

    # ── LiteLLM CustomLogger interface ────────────────────────────────────────

    def log_success_event(self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime) -> None:
        event = self._build_event(kwargs, response_obj, start_time, end_time, success=True)
        self._produce(event)

    def log_failure_event(self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime) -> None:
        event = self._build_event(kwargs, response_obj, start_time, end_time, success=False)
        self._produce(event)

    async def async_log_success_event(
        self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime
    ) -> None:
        self.log_success_event(kwargs, response_obj, start_time, end_time)

    async def async_log_failure_event(
        self, kwargs: Dict, response_obj: Any, start_time: datetime, end_time: datetime
    ) -> None:
        self.log_failure_event(kwargs, response_obj, start_time, end_time)

    # ── Internals ─────────────────────────────────────────────────────────────

    def _build_event(
        self,
        kwargs: Dict,
        response_obj: Any,
        start_time: datetime,
        end_time: datetime,
        success: bool,
    ) -> Dict:
        latency_ms = int((end_time - start_time).total_seconds() * 1000)
        usage = getattr(response_obj, "usage", None) if response_obj else None
        metadata = kwargs.get("litellm_params", {}).get("metadata", {}) or {}

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": metadata.get("atom_agent_id") or metadata.get("agent_id"),
            "model": kwargs.get("model", "unknown"),
            "prompt_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "completion_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
            "latency_ms": latency_ms,
            "success": success,
        }

    def _produce(self, event: Dict) -> None:
        if self._producer is None:
            return
        try:
            payload = json.dumps(event).encode()
            if hasattr(self._producer, "produce"):
                # confluent-kafka
                self._producer.produce(KAFKA_TOPIC, value=payload)
                self._producer.poll(0)
            else:
                # _KafkaPythonWrapper
                self._producer.send(KAFKA_TOPIC, event)
        except Exception as exc:
            logger.error("KafkaAuditLogger: produce failed: %s", exc)


class _KafkaPythonWrapper:
    """Thin wrapper so kafka-python looks like confluent-kafka to _produce."""

    def __init__(self, producer: Any) -> None:
        self._p = producer

    def send(self, topic: str, value: Dict) -> None:
        self._p.send(topic, value=value)
