from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..database import get_conn
from .middleware import require_admin
from .service import hash_password

router = APIRouter()


class InviteRequest(BaseModel):
    email: str
    full_name: str | None = None
    role: str = "developer"
    temp_password: str


class ChangeRoleRequest(BaseModel):
    role: str


@router.get("/")
async def list_users(_: dict = Depends(require_admin)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT id, email, full_name, role, is_active, created_at FROM users ORDER BY created_at DESC"
        )
    return [dict(r) for r in rows]


@router.post("/invite", status_code=201)
async def invite_user(req: InviteRequest, _: dict = Depends(require_admin)):
    if req.role not in ("admin", "developer"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid role")
    async with get_conn() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", req.email)
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="email already registered")
        user = await conn.fetchrow(
            """
            INSERT INTO users (email, password_hash, full_name, role)
            VALUES ($1, $2, $3, $4)
            RETURNING id, email, full_name, role, created_at
            """,
            req.email,
            hash_password(req.temp_password),
            req.full_name,
            req.role,
        )
    return {"user": dict(user)}


@router.patch("/{user_id}/role")
async def change_role(user_id: str, req: ChangeRoleRequest, _: dict = Depends(require_admin)):
    if req.role not in ("admin", "developer"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid role")
    async with get_conn() as conn:
        user = await conn.fetchrow(
            "UPDATE users SET role = $1, updated_at = now() WHERE id = $2 RETURNING id, email, role",
            req.role,
            user_id,
        )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user not found")
    return dict(user)


@router.patch("/{user_id}/deactivate")
async def deactivate_user(user_id: str, _: dict = Depends(require_admin)):
    async with get_conn() as conn:
        user = await conn.fetchrow(
            "UPDATE users SET is_active = false, updated_at = now() WHERE id = $1 RETURNING id, email, is_active",
            user_id,
        )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user not found")
    return dict(user)
