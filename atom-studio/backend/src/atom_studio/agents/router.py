from fastapi import APIRouter, Depends, HTTPException, status

from ..auth.middleware import require_auth
from .service import (
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
    try:
        agent, raw_jwt = await create_agent(domain_id, payload, claims["sub"])
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, detail=str(e))
    return {"agent": agent, "token": raw_jwt}


@router.get("/{agent_id}")
async def get_agent_route(domain_id: str, agent_id: str, _: dict = Depends(require_auth)):
    agent = await get_agent(domain_id, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")
    return agent


@router.delete("/{agent_id}", status_code=204)
async def delete_agent_route(domain_id: str, agent_id: str, _: dict = Depends(require_auth)):
    ok = await delete_agent(domain_id, agent_id)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")


@router.post("/{agent_id}/regenerate-token")
async def regenerate_token_route(domain_id: str, agent_id: str, _: dict = Depends(require_auth)):
    agent = await get_agent(domain_id, agent_id)
    if not agent:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="agent not found")
    raw_jwt = await regenerate_token(agent_id)
    return {"token": raw_jwt}


# ── Global agent listing (mounted at /api/agents) ─────────────────────────────

global_router = APIRouter()


@global_router.get("/")
async def list_all_agents_route(_: dict = Depends(require_auth)):
    return await list_all_agents()
