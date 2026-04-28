import asyncio
import json
from datetime import datetime, timedelta, timezone

from ..database import get_conn
from ..ws.manager import manager


async def create_hitl_request(
    agent_id: str,
    workflow_type: str,
    payload: dict,
    timeout_s: int,
    conn,
) -> dict:
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=timeout_s)
    row = await conn.fetchrow(
        """
        INSERT INTO hitl_workflows (agent_id, workflow_type, payload, status, expires_at)
        VALUES ($1, $2, $3::jsonb, 'pending', $4)
        RETURNING *
        """,
        agent_id,
        workflow_type,
        json.dumps(payload),
        expires_at,
    )

    agent_name = await conn.fetchval("SELECT name FROM agents WHERE id=$1", agent_id)
    await manager.broadcast(
        {
            "type": "NEW_DECISION",
            "hitl_id": str(row["id"]),
            "workflow_type": workflow_type,
            "agent_name": agent_name,
            "payload": payload,
            "expires_at": expires_at.isoformat(),
        }
    )
    return dict(row)


async def decide(
    hitl_id: str,
    approved: bool,
    note: str | None,
    decided_by_user_id: str,
    conn,
) -> None:
    status = "approved" if approved else "rejected"
    await conn.execute(
        """
        UPDATE hitl_workflows
        SET status=$1, decision_note=$2, decided_by=$3, decided_at=now()
        WHERE id=$4
        """,
        status,
        note,
        decided_by_user_id,
        hitl_id,
    )

    await manager.broadcast(
        {
            "type": "DECISION_MADE",
            "hitl_id": hitl_id,
            "approved": approved,
            "note": note,
        }
    )

    if approved:
        row = await conn.fetchrow(
            "SELECT workflow_type, payload FROM hitl_workflows WHERE id=$1", hitl_id
        )
        if row and row["workflow_type"] == "DEPLOYMENT_APPROVAL":
            raw = row["payload"]
            hitl_payload = raw if isinstance(raw, dict) else json.loads(raw)
            deployment_id = hitl_payload["deployment_id"]

            await conn.execute(
                "UPDATE deployments SET status='approved', approved_by=$1 WHERE id=$2",
                decided_by_user_id,
                deployment_id,
            )

            from ..deployments.service import trigger_deployment

            await trigger_deployment(hitl_payload, conn)


async def expire_stale_hitl() -> None:
    """Background loop: expire pending HITL records whose deadline has passed."""
    while True:
        await asyncio.sleep(60)
        async with get_conn() as conn:
            rows = await conn.fetch(
                """
                UPDATE hitl_workflows
                SET status='timed_out'
                WHERE status='pending' AND expires_at < now()
                RETURNING id, agent_id
                """
            )
            for row in rows:
                agent = await conn.fetchrow(
                    "SELECT hitl_fallback FROM agents WHERE id=$1", row["agent_id"]
                )
                await manager.broadcast(
                    {
                        "type": "DECISION_TIMED_OUT",
                        "hitl_id": str(row["id"]),
                        "fallback": agent["hitl_fallback"] if agent else "ABORT",
                    }
                )
