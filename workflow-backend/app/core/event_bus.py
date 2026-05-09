"""
In-process asyncio event bus for SSE delivery.

Activities push events here; SSE endpoints subscribe and stream them.
Single-process V1: no Redis needed.
"""

import asyncio
from collections import defaultdict
from typing import AsyncIterator

# run_id → list of subscriber queues
_subscribers: dict[str, list[asyncio.Queue]] = defaultdict(list)


def publish(run_id: str, event: dict) -> None:
    """Push an event to all SSE subscribers for this run_id (sync-safe)."""
    for q in _subscribers.get(run_id, []):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass


async def subscribe(run_id: str) -> AsyncIterator[dict]:
    """Async generator that yields events for a run_id until workflow ends."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _subscribers[run_id].append(q)
    try:
        while True:
            try:
                event = await asyncio.wait_for(q.get(), timeout=2)
            except asyncio.TimeoutError:
                # Send keepalive ping every 2s to keep SSE connection alive
                yield {"event": "keepalive"}
                continue
            yield event
            if event.get("event") in ("workflow_completed", "workflow_failed",
                                       "workflow_cancelled"):
                break
    finally:
        try:
            _subscribers[run_id].remove(q)
        except ValueError:
            pass
