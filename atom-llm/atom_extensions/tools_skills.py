"""
atom_extensions/tools_skills.py

CRUD endpoints for ATOM tools and skills registries.

POST /atom/tools    — register a tool endpoint
GET  /atom/tools    — list registered tools
POST /atom/skills   — register a skill pip package
GET  /atom/skills   — list registered skills

Tools and skills are stored in ATOM's Postgres (tools / skills tables).
The DATABASE_URL env var must point to the same Postgres instance.
"""

import os
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse, urlunparse

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth

atom_tools_router = APIRouter(prefix="/atom", tags=["ATOM Extensions"])


# ── Pydantic models ───────────────────────────────────────────────────────────


class ToolCreate(BaseModel):
    name: str
    description: Optional[str] = None
    endpoint: str
    schema_json: Optional[Dict[str, Any]] = None


class ToolResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    endpoint: str
    schema_json: Optional[Dict[str, Any]]
    is_active: bool


class SkillCreate(BaseModel):
    name: str
    description: Optional[str] = None
    pip_package: Optional[str] = None


class SkillResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    pip_package: Optional[str]
    is_active: bool


# ── DB helper ─────────────────────────────────────────────────────────────────


async def get_db() -> asyncpg.Connection:
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="DATABASE_URL not configured",
        )
    # asyncpg requires plain postgresql:// with no unrecognised query params.
    parsed = urlparse(db_url)
    clean = parsed._replace(
        scheme="postgresql",
        query="",  # drop all query params (sslmode, connection_limit, etc.)
    )
    db_url = urlunparse(clean)
    try:
        conn = await asyncpg.connect(db_url)
        return conn
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"DB connection failed: {exc}",
        ) from exc


# ── Tools endpoints ───────────────────────────────────────────────────────────


@atom_tools_router.post("/tools", response_model=ToolResponse, status_code=201)
async def create_tool(
    tool: ToolCreate,
    user_api_key_dict: UserAPIKeyAuth = Depends(user_api_key_auth),
) -> ToolResponse:
    conn = await get_db()
    try:
        import json

        row = await conn.fetchrow(
            """INSERT INTO tools (name, description, endpoint, schema_json)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (name) DO UPDATE
                 SET description = EXCLUDED.description,
                     endpoint    = EXCLUDED.endpoint,
                     schema_json = EXCLUDED.schema_json
               RETURNING id::text, name, description, endpoint, schema_json::text, is_active""",
            tool.name,
            tool.description,
            tool.endpoint,
            json.dumps(tool.schema_json) if tool.schema_json else None,
        )
    finally:
        await conn.close()
    return ToolResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        endpoint=row["endpoint"],
        schema_json=__import__("json").loads(row["schema_json"]) if row["schema_json"] else None,
        is_active=row["is_active"],
    )


@atom_tools_router.get("/tools", response_model=List[ToolResponse])
async def list_tools(
    user_api_key_dict: UserAPIKeyAuth = Depends(user_api_key_auth),
) -> List[ToolResponse]:
    conn = await get_db()
    try:
        rows = await conn.fetch(
            "SELECT id::text, name, description, endpoint, schema_json::text, is_active FROM tools WHERE is_active = true ORDER BY name"
        )
    finally:
        await conn.close()
    import json

    return [
        ToolResponse(
            id=r["id"],
            name=r["name"],
            description=r["description"],
            endpoint=r["endpoint"],
            schema_json=json.loads(r["schema_json"]) if r["schema_json"] else None,
            is_active=r["is_active"],
        )
        for r in rows
    ]


# ── Skills endpoints ──────────────────────────────────────────────────────────


@atom_tools_router.post("/skills", response_model=SkillResponse, status_code=201)
async def create_skill(
    skill: SkillCreate,
    user_api_key_dict: UserAPIKeyAuth = Depends(user_api_key_auth),
) -> SkillResponse:
    conn = await get_db()
    try:
        row = await conn.fetchrow(
            """INSERT INTO skills (name, description, pip_package)
               VALUES ($1, $2, $3)
               ON CONFLICT (name) DO UPDATE
                 SET description = EXCLUDED.description,
                     pip_package = EXCLUDED.pip_package
               RETURNING id::text, name, description, pip_package, is_active""",
            skill.name,
            skill.description,
            skill.pip_package,
        )
    finally:
        await conn.close()
    return SkillResponse(**dict(row))


@atom_tools_router.get("/skills", response_model=List[SkillResponse])
async def list_skills(
    user_api_key_dict: UserAPIKeyAuth = Depends(user_api_key_auth),
) -> List[SkillResponse]:
    conn = await get_db()
    try:
        rows = await conn.fetch(
            "SELECT id::text, name, description, pip_package, is_active FROM skills WHERE is_active = true ORDER BY name"
        )
    finally:
        await conn.close()
    return [SkillResponse(**dict(r)) for r in rows]
