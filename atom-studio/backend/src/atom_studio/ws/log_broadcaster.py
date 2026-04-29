"""
WebSocket log broadcaster for atom.agent.logs.

Runs a single aiokafka consumer (group "studio-log-viewer") that reads from
atom.agent.logs and fan-outs each message to all WebSockets subscribed for
the matching agent_id.

Message format expected on the topic (produced by Alloy OTLP or direct emit):
  {"timestamp": "...", "agent_id": "<uuid>", "message": "<log line>", ...}

OTLP-encoded messages (from the Alloy k8s DaemonSet) are also handled:
the exporter embeds agent_id in ResourceAttributes; we attempt to extract it.
"""

import asyncio
import json
import logging
import os
from collections import defaultdict

from fastapi import WebSocket

log = logging.getLogger(__name__)

KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "").strip()
AGENT_LOGS_TOPIC = "atom.agent.logs"
CONSUMER_GROUP = "studio-log-viewer"


class LogBroadcaster:
    def __init__(self):
        # agent_id → list[WebSocket]
        self._sockets: dict[str, list[WebSocket]] = defaultdict(list)
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        if not KAFKA_BROKERS:
            log.info("KAFKA_BROKERS not set — agent log streaming disabled")
            return
        self._task = asyncio.create_task(self._consume(), name="log-broadcaster")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    async def subscribe(self, agent_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._sockets[agent_id].append(ws)

    async def unsubscribe(self, agent_id: str, ws: WebSocket) -> None:
        async with self._lock:
            try:
                self._sockets[agent_id].remove(ws)
            except ValueError:
                pass

    async def _consume(self) -> None:
        from aiokafka import AIOKafkaConsumer  # noqa: PLC0415

        consumer = AIOKafkaConsumer(
            AGENT_LOGS_TOPIC,
            bootstrap_servers=KAFKA_BROKERS,
            group_id=CONSUMER_GROUP,
            auto_offset_reset="latest",
            enable_auto_commit=True,
        )
        await consumer.start()
        log.info("log-broadcaster consuming %s", AGENT_LOGS_TOPIC)
        try:
            async for msg in consumer:
                await self._dispatch(msg.value)
        except asyncio.CancelledError:
            pass
        finally:
            await consumer.stop()

    async def _dispatch(self, raw: bytes) -> None:
        try:
            payload = json.loads(raw)
        except Exception:
            return

        agent_id = _extract_agent_id(payload)
        if not agent_id:
            return

        async with self._lock:
            sockets = list(self._sockets.get(agent_id, []))

        dead: list[WebSocket] = []
        for ws in sockets:
            try:
                await ws.send_json(
                    {
                        "agent_id": agent_id,
                        "timestamp": payload.get("timestamp", ""),
                        "message": _extract_message(payload),
                        "source": payload.get("source", ""),
                    }
                )
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    try:
                        self._sockets[agent_id].remove(ws)
                    except ValueError:
                        pass


def _extract_agent_id(payload: dict) -> str | None:
    # Simple format: top-level agent_id
    if aid := payload.get("agent_id"):
        return str(aid)

    # OTLP JSON: resourceLogs[].resource.attributes[{key:"agent_id"}].value.stringValue
    for rl in payload.get("resourceLogs", []):
        for attr in rl.get("resource", {}).get("attributes", []):
            if attr.get("key") == "agent_id":
                return str(attr.get("value", {}).get("stringValue", ""))
    return None


def _extract_message(payload: dict) -> str:
    # Simple format
    if msg := payload.get("message"):
        return str(msg)
    # OTLP JSON: resourceLogs[].scopeLogs[].logRecords[].body.stringValue
    for rl in payload.get("resourceLogs", []):
        for sl in rl.get("scopeLogs", []):
            for lr in sl.get("logRecords", []):
                body = lr.get("body", {})
                if sv := body.get("stringValue"):
                    return sv
    return str(payload)


broadcaster = LogBroadcaster()
