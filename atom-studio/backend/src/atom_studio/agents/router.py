import logging

from fastapi import APIRouter, Body, Depends, HTTPException, status

from ..auth.middleware import require_auth
from ..ws.emit_agent_log import emit_agent_log
from .service import (

log = logging.getLogger(__name__)
    AgentCreatePayload,
    create_agent,
    delete_agent,
    get_agent,
    list_agents,
    list_all_agents,
    regenerate_token,
)

# ── Per-domain agent routes (mounted at /api/domains/{domain_id}/agents) ──────

router = APIRouter()


@router.get("/")
async def list_agents_route(domain_id: str, claims: dict = Depends(require_auth)):
    return await list_agents(domain_id)


@router.post("/", status_code=201)
async def create_agent_route(
    domain_id: str, payload: AgentCreatePayload, claims: dict = Depends(require_auth)
):
    log.info("create_agent domain=%s name=%s by=%s", domain_id, payload.name, claims["sub"])
    try:
        agent, raw_jwt = await create_agent(domain_id, payload, claims["sub"])
    except ValueError as e:
        log.warning("create_agent failed domain=%s: %s", domain_id, e)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        log.error("create_agent runtime error domain=%s: %s", domain_id, e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(e))
    log.info("agent created id=%s domain=%s name=%s", agent["id"], domain_id, payload.name)
    return {"agent": agent, "token": raw_jwt}


@router.get("/{agent_id}")
async def get_agent_route(domain_id: str, agent_id: str, _: dict = Depends(require_auth)):
    agent = await get_agent(domain_id, agent_id)
    if not agent:
        log.warning("get_agent not found agent=%s domain=%s", agent_id, domain_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent_route(domain_id: str, agent_id: str, _: dict = Depends(require_auth)):
    log.info("delete_agent agent=%s domain=%s", agent_id, domain_id)
    ok = await delete_agent(domain_id, agent_id)
    if not ok:
        log.warning("delete_agent not found agent=%s domain=%s", agent_id, domain_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")
    log.info("agent deleted agent=%s domain=%s", agent_id, domain_id)


@router.post("/{agent_id}/regenerate-token")
async def regenerate_token_route(domain_id: str, agent_id: str, _: dict = Depends(require_auth)):
    agent = await get_agent(domain_id, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")
    log.info("regenerate_token agent=%s domain=%s", agent_id, domain_id)
    raw_jwt = await regenerate_token(agent_id)
    return {"token": raw_jwt}


@router.post("/{agent_id}/test-log", status_code=202)
async def test_log_route(
    domain_id: str,
    agent_id: str,
    message: str = Body(..., embed=True),
    _: dict = Depends(require_auth),
):
    """Emit a test log line to atom.agent.logs for integration testing."""
    agent = await get_agent(domain_id, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")
    await emit_agent_log(agent_id, message)
    return {"queued": True}


# ── Global agent listing (mounted at /api/agents) ─────────────────────────────

global_router = APIRouter()


@global_router.get("/")
async def list_all_agents_route(_: dict = Depends(require_auth)):
    return await list_all_agents()
