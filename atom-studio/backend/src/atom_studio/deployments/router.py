import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn
from .service import register_runtime_url, submit_deployment

log = logging.getLogger(__name__)

router = APIRouter()
runtime_router = APIRouter()


class DeploymentSubmitPayload(BaseModel):
    image: str
    git_sha: str | None = None
    message: str | None = None


class DeployResultPayload(BaseModel):
    deployment_id: str
    status: str  # deployed | failed | rolled_back
    error: str | None = None


class RuntimeRegisterPayload(BaseModel):
    url: str


@router.post("/{agent_id}", status_code=201)
async def submit_deployment_route(
    agent_id: str,
    payload: DeploymentSubmitPayload,
    claims: dict = Depends(require_auth),
):
    log.info("submit_deployment agent=%s image=%s by=%s", agent_id, payload.image, claims["sub"])
    async with get_conn() as conn:
        agent = await conn.fetchrow("SELECT id FROM agents WHERE id=$1", agent_id)
        if not agent:
            log.warning("submit_deployment agent not found agent=%s", agent_id)
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Agent not found")
        deployment = await submit_deployment(
            agent_id=agent_id,
            image=payload.image,
            git_sha=payload.git_sha,
            message=payload.message,
            submitted_by=claims["sub"],
            conn=conn,
        )
    log.info("deployment submitted id=%s agent=%s status=%s", deployment["id"], agent_id, deployment.get("status"))
    return deployment


@router.get("/{agent_id}")
async def list_deployments(agent_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT * FROM deployments
            WHERE agent_id = $1
            ORDER BY version DESC
            """,
            agent_id,
        )
    return [dict(r) for r in rows]


@router.get("/{agent_id}/{deployment_id}")
async def get_deployment(
    agent_id: str,
    deployment_id: str,
    _: dict = Depends(require_auth),
):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM deployments WHERE id=$1 AND agent_id=$2",
            deployment_id,
            agent_id,
        )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Deployment not found")
    return dict(row)


# ── atom-runtime webhook receivers ────────────────────────────────────────────


@runtime_router.post("/deploy-result")
async def deploy_result(payload: DeployResultPayload):
    """Called back by atom-runtime once the k8s rollout finishes."""
    log.info("deploy_result deployment=%s status=%s error=%s", payload.deployment_id, payload.status, payload.error)
    allowed = {"deployed", "failed", "rolled_back"}
    if payload.status not in allowed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=f"Invalid status: {payload.status}")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT agent_id FROM deployments WHERE id=$1", payload.deployment_id
        )
        if not row:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Deployment not found")

        update_sql = (
            "UPDATE deployments SET status=$1, deployed_at=now() WHERE id=$2"
            if payload.status == "deployed"
            else "UPDATE deployments SET status=$1 WHERE id=$2"
        )
        await conn.execute(update_sql, payload.status, payload.deployment_id)

        if payload.status == "deployed":
            await conn.execute(
                "UPDATE agents SET status='deployed', updated_at=now() WHERE id=$1",
                row["agent_id"],
            )
    return {"ok": True}


@runtime_router.post("/register")
async def register_runtime(payload: RuntimeRegisterPayload):
    """atom-runtime calls this on startup to advertise its webhook URL."""
    register_runtime_url(payload.url)
    return {"registered": payload.url}
