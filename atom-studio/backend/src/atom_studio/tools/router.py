import json
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..config import settings
from ..database import get_conn

logger = logging.getLogger(__name__)
router = APIRouter()


class CreateToolRequest(BaseModel):
    model_config = {"populate_by_name": True}

    name: str
    endpoint: str
    json_schema: dict | None = None
    description: str | None = None


@router.get("/")
async def list_tools(_: dict = Depends(require_auth)):
    """Proxy to atom-llm GET /mcp/tools. Falls back to 503 warning if unreachable."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.atom_llm_url}/mcp/tools")
            resp.raise_for_status()
            return resp.json()
    except httpx.HTTPError as exc:
        logger.warning("atom-llm /mcp/tools unreachable: %s", exc)
        return Response(
            content=json.dumps([]),
            media_type="application/json",
            status_code=200,
            headers={"X-ATOM-Tools-Status": "unavailable"},
        )


@router.get("/{tool_name}/schema")
async def get_tool_schema(tool_name: str, _: dict = Depends(require_auth)):
    """Return input schema for a specific MCP tool from atom-llm."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.atom_llm_url}/mcp/tools")
            resp.raise_for_status()
            tools = resp.json()
    except httpx.HTTPError as exc:
        logger.warning("atom-llm /mcp/tools unreachable: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, detail="atom-llm unreachable")
    for tool in tools:
        if tool.get("name") == tool_name:
            return tool.get("inputSchema") or tool.get("input_schema") or {}
    raise HTTPException(status.HTTP_404_NOT_FOUND, detail="tool not found")


@router.post("/", status_code=201)
async def create_tool(req: CreateToolRequest, _: dict = Depends(require_auth)):
    schema_str = json.dumps(req.json_schema) if req.json_schema else None
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO tools (name, endpoint, schema_json, description)
            VALUES ($1,$2,$3::jsonb,$4)
            RETURNING id, name, description, endpoint, is_active, created_at
            """,
            req.name,
            req.endpoint,
            schema_str,
            req.description,
        )
    return dict(row)


@router.get("/db/{tool_id}")
async def get_tool(tool_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, description, endpoint, is_active, created_at FROM tools WHERE id=$1",
            tool_id,
        )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="tool not found")
    return dict(row)
