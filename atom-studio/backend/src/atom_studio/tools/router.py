import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn

router = APIRouter()


class CreateToolRequest(BaseModel):
    model_config = {"populate_by_name": True}

    name: str
    endpoint: str
    json_schema: dict | None = None
    description: str | None = None


@router.get("/")
async def list_tools(_: dict = Depends(require_auth)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, name, description, endpoint, is_active, created_at"
            " FROM tools WHERE is_active=true ORDER BY name"
        )
    return [dict(r) for r in rows]


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


@router.get("/{tool_id}")
async def get_tool(tool_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, description, endpoint, is_active, created_at FROM tools WHERE id=$1",
            tool_id,
        )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="tool not found")
    return dict(row)
