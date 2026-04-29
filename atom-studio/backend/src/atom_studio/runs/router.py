"""
/api/agents/{agent_id}/runs — conversation run storage and retrieval.

The agent's server.py calls POST /runs to record each conversation.
atom-studio UI reads GET /runs for the chat-style conversation view.
"""

import json
import uuid
from datetime import timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn

router = APIRouter()


class RunRecordPayload(BaseModel):
    run_id: str | None = None
    trace_id: str | None = None
    user_msg: str
    reply: str
    steps: list[dict] = []
    latency_ms: int | None = None


@router.post("/", status_code=201)
async def record_run(agent_id: str, payload: RunRecordPayload):
    """Called by the agent container after each /run invocation. No auth required
    (agent JWT is not a human JWT; the endpoint is internal-network only)."""
    run_id = payload.run_id or str(uuid.uuid4())
    async with get_conn() as conn:
        agent = await conn.fetchrow("SELECT id FROM agents WHERE id=$1", agent_id)
        if not agent:
            raise HTTPException(status_code=404, detail="agent not found")
        row = await conn.fetchrow(
            """
            INSERT INTO agent_runs (agent_id, run_id, trace_id, user_msg, reply, steps, latency_ms)
            VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
            ON CONFLICT (run_id) DO UPDATE
              SET reply=$5, steps=$6::jsonb, latency_ms=$7
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
            SELECT id, run_id, trace_id, user_msg, reply, steps, latency_ms, created_at
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
                "trace_id": r["trace_id"],
                "user_msg": r["user_msg"],
                "reply": r["reply"],
                "steps": r["steps"],
                "latency_ms": r["latency_ms"],
                "created_at": r["created_at"].replace(tzinfo=timezone.utc).isoformat(),
            }
            for r in rows
        ],
    }
