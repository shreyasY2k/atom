from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from ..auth.service import decode_token
from .manager import manager

ws_router = APIRouter()


@ws_router.websocket("/hitl")
async def hitl_ws(websocket: WebSocket, token: str = Query(...)):
    """Real-time HITL events. Authenticated via ?token= query param."""
    try:
        claims = decode_token(token)
        if claims.get("type") != "human":
            await websocket.close(code=4401)
            return
    except ValueError:
        await websocket.close(code=4401)
        return

    user_id = claims["sub"]
    await manager.connect(websocket, user_id)
    try:
        while True:
            # Keep the socket open; we only push, never receive
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket, user_id)
