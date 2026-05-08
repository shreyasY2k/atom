"""Emit structured audit events and SSE events from inside Temporal activities."""

import hashlib
import json
import time

from app.core import audit
from app.core.event_bus import publish


def node_start(run_id: str, node_id: str, node_type: str,
               actor_type: str, actor_id: str) -> float:
    """Emit node_start audit + SSE. Returns wall-clock start time."""
    audit.emit_node_start(run_id, node_id, node_type, actor_type, actor_id)
    publish(run_id, {
        "event": "node_started",
        "run_id": run_id,
        "node_id": node_id,
        "node_type": node_type,
        "actor_type": actor_type,
        "actor_id": actor_id,
    })
    return time.time()


def node_complete(run_id: str, node_id: str, node_type: str,
                  actor_type: str, actor_id: str,
                  start_time: float, output: dict,
                  result: str = "ok") -> None:
    duration_ms = int((time.time() - start_time) * 1000)
    output_hash = "sha256:" + hashlib.sha256(
        json.dumps(output, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]

    audit.emit_node_complete(run_id, node_id, node_type, actor_type, actor_id,
                             duration_ms, result, output_hash)
    publish(run_id, {
        "event": "node_completed",
        "run_id": run_id,
        "node_id": node_id,
        "output_summary": {k: v for k, v in output.items()
                           if k in ("confidence", "recommendation", "status",
                                    "resolution", "hit", "decision")},
        "duration_ms": duration_ms,
        "result": result,
    })


def node_routed(run_id: str, from_id: str, to_id: str, reason: str) -> None:
    publish(run_id, {
        "event": "node_routed",
        "run_id": run_id,
        "from": from_id,
        "to": to_id,
        "reason": reason,
    })


def node_paused(run_id: str, node_id: str, task_id: str) -> None:
    publish(run_id, {
        "event": "node_paused",
        "run_id": run_id,
        "node_id": node_id,
        "task_id": task_id,
        "reason": "waiting for human task resolution",
    })
