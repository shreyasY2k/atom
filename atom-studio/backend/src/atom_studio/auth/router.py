from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..database import get_conn
from .middleware import require_auth
from .service import (
    create_access_token,
    create_refresh_token,
    hash_password,
    revoke_refresh_token,
    store_refresh_token,
    validate_refresh_token,
    verify_password,
)

router = APIRouter()


class RegisterRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


@router.post("/register", status_code=201)
async def register(req: RegisterRequest):
    async with get_conn() as conn:
        existing = await conn.fetchrow("SELECT id FROM users WHERE email = $1", req.email)
        if existing:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="email already registered")
        user = await conn.fetchrow(
            """
            INSERT INTO users (email, password_hash, full_name, role)
            VALUES ($1, $2, $3, 'developer')
            RETURNING id, email, full_name, role, created_at
            """,
            req.email,
            hash_password(req.password),
            req.full_name,
        )
    return {"user": dict(user)}


@router.post("/login")
async def login(req: LoginRequest):
    async with get_conn() as conn:
        user = await conn.fetchrow(
            "SELECT id, email, full_name, role, password_hash, is_active FROM users WHERE email = $1",
            req.email,
        )
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    if not user["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="account deactivated")

    access_token = create_access_token(str(user["id"]), user["role"])
    refresh_token = create_refresh_token()
    await store_refresh_token(refresh_token, str(user["id"]))

    return {"access_token": access_token, "refresh_token": refresh_token, "token_type": "bearer"}


@router.post("/refresh")
async def refresh(req: RefreshRequest):
    user_id = await validate_refresh_token(req.refresh_token)
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid or expired refresh token")

    async with get_conn() as conn:
        user = await conn.fetchrow("SELECT id, role, is_active FROM users WHERE id = $1", user_id)
    if not user or not user["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="user not found or inactive")

    await revoke_refresh_token(req.refresh_token)
    new_refresh = create_refresh_token()
    await store_refresh_token(new_refresh, user_id)
    new_access = create_access_token(user_id, user["role"])

    return {"access_token": new_access, "refresh_token": new_refresh, "token_type": "bearer"}


@router.post("/logout", status_code=204)
async def logout(req: LogoutRequest):
    await revoke_refresh_token(req.refresh_token)


@router.get("/me")
async def me(claims: dict = Depends(require_auth)):
    async with get_conn() as conn:
        user = await conn.fetchrow(
            "SELECT id, email, full_name, role, created_at FROM users WHERE id = $1",
            claims["sub"],
        )
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="user not found")
    return dict(user)
