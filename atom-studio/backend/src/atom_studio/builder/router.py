import json
import logging
import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..config import settings
from ..database import get_conn
from ..redis_client import get_redis
from ..services.ai import STUDIO_INTENT_MODEL
from ..services.builder_conversation import BuilderState, load_state, process_turn, save_state
from ..services.builder_deploy import run_deploy

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/models")
async def list_models(_: dict = Depends(require_auth)):
    """Proxy to atom-llm GET /models — only models with valid API keys are returned."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{settings.atom_llm_url}/models",
                headers={"Authorization": f"Bearer {settings.litellm_master_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            models = data.get("data", data) if isinstance(data, dict) else data
            return [
                {
                    "id": m.get("id", m.get("model_name", "")),
                    "name": m.get("id", m.get("model_name", "")),
                }
                for m in models
                if m.get("id") or m.get("model_name")
            ]
    except httpx.HTTPError as exc:
        logger.warning("atom-llm /models unreachable: %s", exc)
        return []


@router.get("/a2a-agents")
async def list_a2a_agents(domain_id: str, _: dict = Depends(require_auth)):
    """Return deployed agents in the same domain for A2A connection suggestions."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, name, description FROM agents WHERE domain_id=$1 AND status='deployed' ORDER BY name",
            domain_id,
        )
    return [dict(r) for r in rows]


class AnalyseIntentRequest(BaseModel):
    intent: str
    domain_id: str


@router.post("/analyse-intent")
async def analyse_intent(req: AnalyseIntentRequest, _: dict = Depends(require_auth)):
    """
    Use gemini-2.5-flash to parse intent and suggest capabilities.
    Returns suggested model, skills, tools, and a2a agents.
    """
    prompt = f"""You are an ATOM AI platform assistant. A user wants to build an agent.

Intent: {req.intent}

Suggest the best configuration for this agent. Return a JSON object with:
- "model": one of [gemini-2.5-flash, gemini-3.1-pro-preview, gemini-2.0-flash, gpt-4o, claude-sonnet-4]
- "skills": list from [atom-gate-calls, atom-hitl, atom-memory, atom-react-agent, atom-multi-agent, atom-a2a, atom-audit] (always include atom-gate-calls and atom-audit)
- "tools": list of suggested MCP tool names (use generic names like "database-query", "send-email" if specific tools unknown)
- "reasoning": brief explanation of choices

Return valid JSON only, no markdown."""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{settings.atom_llm_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.litellm_master_key}"},
                json={
                    "model": STUDIO_INTENT_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "response_format": {"type": "json_object"},
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"]
            return json.loads(content)
    except Exception as exc:
        logger.error("intent analysis failed: %s", exc)
        return {
            "model": "gemini-2.5-flash",
            "skills": ["atom-gate-calls", "atom-audit", "atom-react-agent"],
            "tools": [],
            "reasoning": "Default suggestion (intent analysis unavailable)",
        }


# ── Conversational Builder routes ──────────────────────────────────────────────


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    domain_id: str = ""
    ci_target: str = "gitlab"


@router.post("/chat")
async def builder_chat(req: ChatRequest, claims: dict = Depends(require_auth)):
    """
    Conversational agent builder — SSE stream.

    Each response event is a JSON object on a 'data:' line.
    Event types: session_id | token | spec_update | stage_change | done
    """
    redis = await get_redis()
    is_new_session = req.session_id is None

    if req.session_id:
        state = await load_state(redis, req.session_id)
        if state is None:
            # Treat missing session as a new one
            is_new_session = True
            state = BuilderState(session_id=str(uuid.uuid4()))
    else:
        state = BuilderState(session_id=str(uuid.uuid4()))

    if is_new_session:
        state.domain_id = req.domain_id
        state.ci_target = req.ci_target

    prev_stage = state.stage

    ai_message, options, updates, new_stage = await process_turn(
        state=state,
        user_message=req.message,
        atom_llm_url=settings.atom_llm_url,
        litellm_master_key=settings.litellm_master_key,
        studio_intent_model=STUDIO_INTENT_MODEL,
    )

    await save_state(redis, state)

    async def event_stream():
        if is_new_session:
            yield f"data: {json.dumps({'type': 'session_id', 'session_id': state.session_id})}\n\n"
        yield f"data: {json.dumps({'type': 'token', 'content': ai_message, 'options': options})}\n\n"
        if updates:
            yield f"data: {json.dumps({'type': 'spec_update', 'updates': updates})}\n\n"
        if new_stage != prev_stage:
            yield f"data: {json.dumps({'type': 'stage_change', 'stage': new_stage})}\n\n"
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class DeployRequest(BaseModel):
    session_id: str


@router.post("/deploy")
async def builder_deploy(req: DeployRequest, claims: dict = Depends(require_auth)):
    """
    Deploy the agent described in the builder session — SSE stream.

    Event types: progress | pipeline_poll | error | done
    """
    redis = await get_redis()
    state = await load_state(redis, req.session_id)
    if state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Builder session not found")
    if state.stage not in ("confirming", "confirmed"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail=f"Session is not ready to deploy (stage={state.stage!r}). Complete the interview first.",
        )

    owner_id: str = claims["sub"]

    async def event_stream():
        async for event in run_deploy(state, owner_id, redis):
            yield f"data: {json.dumps(event)}\n\n"
        await save_state(redis, state)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/session/{session_id}")
async def get_builder_session(session_id: str, _: dict = Depends(require_auth)):
    """Return full BuilderState JSON for the given session."""
    redis = await get_redis()
    state = await load_state(redis, session_id)
    if state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Builder session not found")
    from dataclasses import asdict

    return asdict(state)
