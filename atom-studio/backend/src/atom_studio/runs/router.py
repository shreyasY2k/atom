"""
/api/agents/{agent_id}/runs — conversation run storage and retrieval.

Two write paths:
  1. POST /runs (legacy/atom SDK) — full run stored at once after completion.
  2. POST /trpc/registerRun + POST /trpc/pushMessage (agentscope tRPC) —
     incremental: run created first, messages pushed one-by-one, marked
     complete when the run finishes.

atom-studio UI reads GET /runs for the chat-style conversation view.
WS /ws/agents/{agent_id}/runs/{run_id} broadcasts live messages as they arrive.
"""

import json
import logging
import uuid
from datetime import timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

log = logging.getLogger(__name__)

from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn
from ..ws.run_broadcaster import run_broadcaster


def _parse_jsonb_list(value: Any) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


router = APIRouter()

# ── tRPC-compatible router (no prefix — mounted at root for agentscope compat) ─

trpc_router = APIRouter()


class RegisterRunPayload(BaseModel):
    run_id: str | None = None
    id: str | None = None  # agentscope sends 'id'
    name: str | None = None
    timestamp: str | None = None


class PushMessagePayload(BaseModel):
    run_id: str | None = None
    role: str = "assistant"
    name: str | None = None
    content: str = ""
    url: str | None = None  # media attachment (voice, image)
    metadata: dict | None = None


@trpc_router.post("/trpc/registerRun", status_code=200)
async def trpc_register_run(payload: RegisterRunPayload, request: Request):
    """
    Called by agentscope.init() when an agent starts a new run.
    Creates a 'running' record so atom-studio can show it immediately.
    """
    run_id = payload.run_id or payload.id or str(uuid.uuid4())

    # Try to resolve the agent from the request host (X-ATOM-Agent-ID header)
    agent_id = request.headers.get("X-ATOM-Agent-ID")

    async with get_conn() as conn:
        if agent_id:
            agent = await conn.fetchrow("SELECT id FROM agents WHERE id=$1", agent_id)
        else:
            agent = None

        if agent:
            await conn.execute(
                """
                INSERT INTO agent_runs
                  (agent_id, run_id, run_name, user_msg, reply, status)
                VALUES ($1, $2, $3, '', '', 'running')
                ON CONFLICT (run_id) DO NOTHING
                """,
                agent_id,
                run_id,
                payload.name or run_id,
            )

    return {"success": True, "run_id": run_id}


@trpc_router.post("/trpc/pushMessage", status_code=200)
async def trpc_push_message(payload: PushMessagePayload, request: Request):
    """
    Called by agentscope for each message in a run (user, assistant, system, tool).
    Appends to the messages JSONB column and broadcasts over WebSocket.
    """
    run_id = payload.run_id
    if not run_id:
        return {"success": False, "error": "run_id required"}

    message = {
        "role": payload.role,
        "name": payload.name,
        "content": payload.content,
        "url": payload.url,
        "metadata": payload.metadata,
    }

    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            UPDATE agent_runs
            SET messages = messages || $1::jsonb
            WHERE run_id = $2
            RETURNING agent_id, run_id
            """,
            json.dumps([message]),
            run_id,
        )
        if not row:
            return {"success": False, "error": "run not found"}

    # Broadcast the new message to any open WebSocket connections
    await run_broadcaster.broadcast(run_id, message)

    return {"success": True}


@trpc_router.post("/trpc/completeRun", status_code=200)
async def trpc_complete_run(request: Request):
    """Mark a run as complete (called by agentscope on run teardown)."""
    try:
        body = await request.json()
    except Exception:
        body = {}
    run_id = body.get("run_id") or body.get("id")
    if not run_id:
        return {"success": False}
    async with get_conn() as conn:
        await conn.execute(
            "UPDATE agent_runs SET status='complete' WHERE run_id=$1",
            run_id,
        )
    await run_broadcaster.broadcast(run_id, {"__status": "complete"})
    return {"success": True}


@trpc_router.post("/v1/traces", status_code=200)
async def otel_traces_sink():
    """Absorb OTEL traces that agentscope sends when studio_url is set."""
    return {"success": True}


# ── Standard runs API ─────────────────────────────────────────────────────────


class RunRecordPayload(BaseModel):
    run_id: str | None = None
    trace_id: str | None = None
    user_msg: str
    reply: str
    steps: list[dict] = []
    latency_ms: int | None = None


@router.post("/", status_code=201)
async def record_run(agent_id: str, payload: RunRecordPayload):
    """
    Called by the agent container after each /run invocation. No auth required
    (agent JWT is not a human JWT; the endpoint is internal-network only).
    """
    run_id = payload.run_id or str(uuid.uuid4())
    log.info("record_run agent=%s run=%s latency_ms=%s", agent_id, run_id, payload.latency_ms)
    async with get_conn() as conn:
        agent = await conn.fetchrow("SELECT id FROM agents WHERE id=$1", agent_id)
        if not agent:
            log.warning("record_run agent not found agent=%s", agent_id)
            raise HTTPException(status_code=404, detail="agent not found")
        row = await conn.fetchrow(
            """
            INSERT INTO agent_runs
              (agent_id, run_id, trace_id, user_msg, reply, steps, latency_ms, status)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 'complete')
            ON CONFLICT (run_id) DO UPDATE
              SET reply=$5, steps=$6::jsonb, latency_ms=$7, status='complete'
            RETURNING *
            """,
            agent_id,
            run_id,
            payload.trace_id,
            payload.user_msg,
            payload.reply,
            json.dumps(payload.steps),
            payload.latency_ms,
        )
    await run_broadcaster.broadcast(run_id, {"__status": "complete"})
    return {
        "id": str(row["id"]),
        "run_id": row["run_id"],
        "created_at": row["created_at"].replace(tzinfo=timezone.utc).isoformat(),
    }


@router.get("/")
async def list_runs(
    agent_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    _: dict = Depends(require_auth),
):
    offset = (page - 1) * page_size
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, run_id, run_name, trace_id, user_msg, reply,
                   steps, messages, latency_ms, status, created_at
            FROM agent_runs
            WHERE agent_id=$1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            """,
            agent_id,
            page_size,
            offset,
        )
        total = await conn.fetchval("SELECT COUNT(*) FROM agent_runs WHERE agent_id=$1", agent_id)
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "id": str(r["id"]),
                "run_id": r["run_id"],
                "run_name": r["run_name"],
                "trace_id": r["trace_id"],
                "user_msg": r["user_msg"],
                "reply": r["reply"],
                "steps": _parse_jsonb_list(r["steps"]),
                "messages": _parse_jsonb_list(r["messages"]),
                "latency_ms": r["latency_ms"],
                "status": r["status"],
                "created_at": r["created_at"].replace(tzinfo=timezone.utc).isoformat(),
            }
            for r in rows
        ],
    }


@router.get("/{run_id}")
async def get_run(agent_id: str, run_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, run_id, run_name, trace_id, user_msg, reply,
                   steps, messages, latency_ms, status, created_at
            FROM agent_runs WHERE agent_id=$1 AND run_id=$2
            """,
            agent_id,
            run_id,
        )
    if not row:
        raise HTTPException(status_code=404, detail="run not found")
    return {
        "id": str(row["id"]),
        "run_id": row["run_id"],
        "run_name": row["run_name"],
        "trace_id": row["trace_id"],
        "user_msg": row["user_msg"],
        "reply": row["reply"],
        "steps": _parse_jsonb_list(row["steps"]),
        "messages": _parse_jsonb_list(row["messages"]),
        "latency_ms": row["latency_ms"],
        "status": row["status"],
        "created_at": row["created_at"].replace(tzinfo=timezone.utc).isoformat(),
    }
