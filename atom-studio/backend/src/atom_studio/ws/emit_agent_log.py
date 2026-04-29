"""
Helper to emit a test log line to the atom.agent.logs Kafka topic.
Used by integration tests and the /api/agents/{id}/test-log debug endpoint.
"""

from datetime import datetime, timezone

from ..kafka_producer import emit


async def emit_agent_log(agent_id: str, message: str, source: str = "stdout") -> None:
    await emit(
        "atom.agent.logs",
        {
            "agent_id": agent_id,
            "message": message,
            "source": source,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )
