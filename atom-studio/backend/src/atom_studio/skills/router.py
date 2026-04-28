from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.middleware import require_auth
from ..database import get_conn

router = APIRouter()


class CreateSkillRequest(BaseModel):
    name: str
    pip_package: str | None = None
    description: str | None = None


@router.get("/")
async def list_skills(_: dict = Depends(require_auth)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, name, description, pip_package, is_active, created_at"
            " FROM skills WHERE is_active=true ORDER BY name"
        )
    return [dict(r) for r in rows]


@router.post("/", status_code=201)
async def create_skill(req: CreateSkillRequest, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO skills (name, pip_package, description)
            VALUES ($1,$2,$3)
            RETURNING id, name, description, pip_package, is_active, created_at
            """,
            req.name,
            req.pip_package,
            req.description,
        )
    return dict(row)


@router.get("/{skill_id}")
async def get_skill(skill_id: str, _: dict = Depends(require_auth)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, name, description, pip_package, is_active, created_at"
            " FROM skills WHERE id=$1",
            skill_id,
        )
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="skill not found")
    return dict(row)
