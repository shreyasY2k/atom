from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn
from .service import create_hitl_request, decide

router = APIRouter()


class HitlRequestPayload(BaseModel):
    agent_id: str
    workflow_type: str
    payload: dict
    timeout_s: int = 300


class DecidePayload(BaseModel):
    approved: bool
    note: str | None = None


# Static routes MUST come before parameterised /{hitl_id}


@router.get("/queue")
async def get_queue(claims: dict = Depends(require_auth)):
    async with get_conn() as conn:
        if claims.get("role") == "admin":
            rows = await conn.fetch(
                """
                SELECT h.*, a.name AS agent_name
                FROM hitl_workflows h
                JOIN agents a ON a.id = h.agent_id
                WHERE h.status = 'pending'
                ORDER BY h.created_at DESC
                """
            )
        else:
            rows = await conn.fetch(
                """
                SELECT h.*, a.name AS agent_name
                FROM hitl_workflows h
                JOIN agents a ON a.id = h.agent_id
                WHERE h.status = 'pending'
                  AND a.owner_id = $1
                ORDER BY h.created_at DESC
                """,
                claims["sub"],
            )
    return [dict(r) for r in rows]


@router.get("/history")
async def get_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    _: dict = Depends(require_auth),
):
    offset = (page - 1) * per_page
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT h.*, a.name AS agent_name
            FROM hitl_workflows h
            JOIN agents a ON a.id = h.agent_id
            WHERE h.status != 'pending'
            ORDER BY h.created_at DESC
            LIMIT $1 OFFSET $2
            """,
            per_page,
            offset,
        )
    return [dict(r) for r in rows]


@router.post("/request", status_code=201)
async def request_hitl(payload: HitlRequestPayload):
    """Called by agent SDK via GATE (network-internal; no human auth required)."""
    async with get_conn() as conn:
        row = await create_hitl_request(
            agent_id=payload.agent_id,
            workflow_type=payload.workflow_type,
            payload=payload.payload,
            timeout_s=payload.timeout_s,
            conn=conn,
        )
    return {"hitl_id": str(row["id"])}


@router.get("/{hitl_id}")
async def get_hitl(hitl_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT h.*, a.name AS agent_name
            FROM hitl_workflows h
            JOIN agents a ON a.id = h.agent_id
            WHERE h.id = $1
            """,
            hitl_id,
        )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="HITL workflow not found")
    return dict(row)


@router.post("/{hitl_id}/decide")
async def decide_hitl(
    hitl_id: str,
    payload: DecidePayload,
    claims: dict = Depends(require_auth),
):
    async with get_conn() as conn:
        row = await conn.fetchrow("SELECT status FROM hitl_workflows WHERE id=$1", hitl_id)
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="HITL workflow not found")
        if row["status"] != "pending":
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Workflow already '{row['status']}'",
            )
        await decide(hitl_id, payload.approved, payload.note, claims["sub"], conn)
    return {"status": "approved" if payload.approved else "rejected"}
