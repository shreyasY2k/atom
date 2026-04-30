"""
In-process pub/sub for live run messages.

run_broadcaster.broadcast(run_id, message) — called by the tRPC push handler.
Delivers to all WebSocket connections subscribed to that run_id.
"""

import asyncio
from collections import defaultdict

from fastapi import WebSocket


class RunBroadcaster:
    def __init__(self) -> None:
        # run_id → set of websockets
        self._subscribers: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, run_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subscribers[run_id].add(ws)

    async def unsubscribe(self, run_id: str, ws: WebSocket) -> None:
        async with self._lock:
            self._subscribers[run_id].discard(ws)
            if not self._subscribers[run_id]:
                del self._subscribers[run_id]

    async def broadcast(self, run_id: str, message: dict) -> None:
        import json as _json

        sockets = set(self._subscribers.get(run_id, set()))
        dead = set()
        for ws in sockets:
            try:
                await ws.send_text(_json.dumps(message))
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._subscribers[run_id] -= dead


run_broadcaster = RunBroadcaster()
