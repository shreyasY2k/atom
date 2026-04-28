from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self):
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, user_id: str) -> None:
        await websocket.accept()
        self._connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: str) -> None:
        try:
            self._connections[user_id].remove(websocket)
        except ValueError:
            pass

    async def broadcast(self, event: dict) -> None:
        """Send event to every connected browser tab across all users."""
        dead: list[tuple[str, WebSocket]] = []
        for user_id, sockets in list(self._connections.items()):
            for ws in sockets:
                try:
                    await ws.send_json(event)
                except Exception:
                    dead.append((user_id, ws))
        for uid, ws in dead:
            try:
                self._connections[uid].remove(ws)
            except ValueError:
                pass


manager = ConnectionManager()
