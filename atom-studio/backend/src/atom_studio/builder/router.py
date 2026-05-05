import json
import logging

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..config import settings
from ..database import get_conn
from ..services.ai import STUDIO_INTENT_MODEL

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
