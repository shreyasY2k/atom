import logging

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..config import settings
from ..database import get_conn
from ..services.ai import STUDIO_CODEGEN_MODEL
from ..services.builder import build_agent_py_prompt
from ..ws.emit_agent_log import emit_agent_log
from .service import (
    AgentCreatePayload,
    create_agent,
    delete_agent,
    get_agent,
    list_agents,
    list_all_agents,
    regenerate_token,
)

log = logging.getLogger(__name__)

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


# ── Global agent listing + build-and-deploy (mounted at /api/agents) ─────────

global_router = APIRouter()


@global_router.get("/")
async def list_all_agents_route(_: dict = Depends(require_auth)):
    return await list_all_agents()


class BuildAndDeployRequest(BaseModel):
    intent: str
    model: str = "gemini-2.5-flash"
    mcp_tools: list[str] = []
    skills: list[str] = []
    a2a_links: list[str] = []
    domain_id: str
    ci_config: dict = {}


@global_router.post("/build-and-deploy", status_code=202)
async def build_and_deploy_route(
    req: BuildAndDeployRequest,
    claims: dict = Depends(require_auth),
):
    """
    One-click agent provisioning:
    1. Create agent record (status=provisioning)
    2. Generate agent.py via gemini-3.1-pro-preview
    3. Trigger CI/deploy pipeline
    Returns agent id and generated code.
    """
    payload = AgentCreatePayload(
        name=req.intent[:60].strip(),
        description=req.intent,
        allowed_models=[req.model],
    )
    try:
        agent, raw_jwt = await create_agent(req.domain_id, payload, claims["sub"])
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail=str(e))

    agent_id = agent["id"]
    log.info("build_and_deploy agent=%s domain=%s by=%s", agent_id, req.domain_id, claims["sub"])

    # Fetch full tool objects for prompt context
    tools: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.atom_llm_url}/mcp/tools")
            if resp.status_code == 200:
                all_tools = resp.json()
                tools = [t for t in all_tools if t.get("name") in req.mcp_tools]
    except httpx.HTTPError:
        pass

    # Fetch A2A agent details
    a2a_targets: list[dict] = []
    if req.a2a_links:
        async with get_conn() as conn:
            rows = await conn.fetch(
                "SELECT id, name FROM agents WHERE id = ANY($1::uuid[])",
                req.a2a_links,
            )
            a2a_targets = [dict(r) for r in rows]

    # Generate agent.py
    prompt = build_agent_py_prompt(
        intent=req.intent,
        model_name=req.model,
        tools=tools,
        skills=req.skills,
        a2a_targets=a2a_targets,
    )

    agent_py = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{settings.atom_llm_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.litellm_master_key}"},
                json={
                    "model": STUDIO_CODEGEN_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            agent_py = resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        log.error("codegen failed agent=%s: %s", agent_id, exc)

    # Persist tool + skill associations
    async with get_conn() as conn:
        for tool_name in req.mcp_tools:
            row = await conn.fetchrow("SELECT id FROM tools WHERE name=$1", tool_name)
            if row:
                await conn.execute(
                    "INSERT INTO agent_tools (agent_id, tool_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                    agent_id,
                    row["id"],
                )
        for skill_name in req.skills:
            row = await conn.fetchrow("SELECT id FROM skills WHERE name=$1", skill_name)
            if row:
                await conn.execute(
                    "INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
                    agent_id,
                    row["id"],
                )

    async with get_conn() as conn:
        await conn.execute(
            "INSERT INTO deployments (agent_id, status, submitted_by) VALUES ($1,'pending',$2::uuid)",
            agent_id,
            claims["sub"],
        )

    return {
        "agent_id": agent_id,
        "token": raw_jwt,
        "agent_py": agent_py,
        "status": "pending",
    }
