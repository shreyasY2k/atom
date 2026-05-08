"""Proxy routes for AgentScope Studio — tRPC queries AND Socket.io data.

The browser cannot call Studio (port 3000) cross-origin due to CORS.
These endpoints proxy server-to-server:
  GET /studio/trpc/{procedure}?input=...   → Studio tRPC queries
  POST /studio/trpc/{procedure}            → Studio tRPC mutations
  GET /studio/runs?project=...             → runs list via Socket.io /client namespace
  GET /studio/runs/{run_id}/messages       → run messages via Socket.io
  GET /studio/runs/{run_id}/spans          → run OTEL spans via Socket.io
"""

import asyncio
import json
import os
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

router = APIRouter(prefix="/studio", tags=["studio"])

STUDIO_URL = os.environ.get("STUDIO_URL", "http://studio:3000")


# ── tRPC proxy ────────────────────────────────────────────────────────────────

@router.get("/trpc/{procedure}")
async def proxy_studio_query(procedure: str, request: Request):
    """Forward a tRPC query to Studio /trpc/{procedure}."""
    input_param = request.query_params.get("input", "")
    try:
        url = f"{STUDIO_URL}/trpc/{procedure}"
        params = {}
        if input_param:
            params["input"] = input_param
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url, params=params)
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Studio is not reachable. Is it running on port 3000?")
    except Exception as e:
        raise HTTPException(502, f"Studio proxy error: {e}")


@router.post("/trpc/{procedure}")
async def proxy_studio_mutation(procedure: str, request: Request):
    """Forward a tRPC mutation to Studio."""
    try:
        body = await request.json()
        url = f"{STUDIO_URL}/trpc/{procedure}"
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(url, json=body, headers={"Content-Type": "application/json"})
        return r.json()
    except httpx.ConnectError:
        raise HTTPException(503, "Studio is not reachable.")
    except Exception as e:
        raise HTTPException(502, f"Studio proxy error: {e}")


# ── Socket.io data fetcher ────────────────────────────────────────────────────

async def _socketio_fetch(event_to_emit: str, emit_data: str, listen_event: str, timeout: float = 8.0) -> Optional[object]:
    """Connect to Studio's /client Socket.io namespace, emit an event, return the first response."""
    try:
        import socketio  # type: ignore
    except ImportError:
        return None

    result = None
    done = asyncio.Event()

    sio = socketio.AsyncClient()

    @sio.on(listen_event, namespace="/client")
    async def on_data(data):
        nonlocal result
        result = data
        done.set()

    try:
        await sio.connect(STUDIO_URL, namespaces=["/client"])
        await sio.emit(event_to_emit, emit_data, namespace="/client")
        await asyncio.wait_for(done.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass
    finally:
        try:
            await sio.disconnect()
        except Exception:
            pass

    return result


@router.get("/runs")
async def get_project_runs(project: str = Query(..., description="Service account ID")):
    """Get all runs for a project via Studio Socket.io /client namespace."""
    data = await _socketio_fetch(
        event_to_emit="joinProjectRoom",
        emit_data=project,
        listen_event="pushRunsData",
        timeout=8.0,
    )
    if data is None:
        # Fallback: try to get runs from tRPC getTraces without filter
        # and match by project from run registration
        return {"runs": [], "source": "unavailable"}

    # data is a list of RunData objects
    runs = []
    for r in (data if isinstance(data, list) else []):
        runs.append({
            "id": r.get("id", ""),
            "name": r.get("name", ""),
            "status": r.get("status", "unknown"),
            "timestamp": r.get("timestamp", ""),
            "project": r.get("project", project),
            "run_dir": r.get("run_dir"),
        })
    return {"runs": runs, "source": "socket.io"}


@router.get("/runs/{run_id}/messages")
async def get_run_messages(run_id: str):
    """Get all messages (replies) for a run via Studio Socket.io."""
    data = await _socketio_fetch(
        event_to_emit="joinRunRoom",
        emit_data=run_id,
        listen_event="pushMessages",
        timeout=8.0,
    )
    if data is None:
        return {"messages": [], "source": "unavailable"}
    return {"messages": data if isinstance(data, list) else [], "source": "socket.io"}


@router.get("/runs/{run_id}/spans")
async def get_run_spans(run_id: str):
    """Get OTEL spans for a run via Studio Socket.io."""
    data = await _socketio_fetch(
        event_to_emit="joinRunRoom",
        emit_data=run_id,
        listen_event="pushSpans",
        timeout=8.0,
    )
    if data is None:
        return {"spans": [], "source": "unavailable"}
    return {"spans": data if isinstance(data, list) else [], "source": "socket.io"}
