"""
atom-studio Kafka producer.

Emits lifecycle events from atom-studio-api to Kafka topics:
  - atom.deployments  — deployment submitted / approved / rejected
  - atom.audit        — key security events (agent suspend, token regen)

Init via init_producer() at startup; stop via stop_producer() at shutdown.
"""

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

log = logging.getLogger(__name__)

_producer: Any = None


async def init_producer() -> None:
    global _producer
    brokers = os.environ.get("KAFKA_BROKERS", "").strip()
    if not brokers:
        log.info("KAFKA_BROKERS not set — Kafka events disabled for atom-studio-api")
        return
    try:
        from aiokafka import AIOKafkaProducer  # noqa: PLC0415

        _producer = AIOKafkaProducer(
            bootstrap_servers=brokers,
            value_serializer=lambda v: json.dumps(v).encode(),
        )
        await _producer.start()
        log.info("atom-studio Kafka producer connected → %s", brokers)
    except Exception as exc:
        log.warning("Kafka producer init failed (%s) — events will be dropped", exc)


async def stop_producer() -> None:
    global _producer
    if _producer is not None:
        try:
            await _producer.stop()
        except Exception:
            pass
        _producer = None


async def emit(topic: str, event: dict[str, Any]) -> None:
    if _producer is None:
        return
    event.setdefault("timestamp", datetime.now(timezone.utc).isoformat())
    event.setdefault("source", "atom-studio-api")
    try:
        await _producer.send(topic, event)
    except Exception as exc:
        log.warning("Kafka emit to %s failed: %s", topic, exc)
