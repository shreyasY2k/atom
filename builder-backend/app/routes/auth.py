"""Role-button login for demo.

V1 SECURITY BOUNDARY: Backends trust X-Atom-Actor header unconditionally.
The cookie and /auth/me are UX conveniences for the frontend; the header
is the actual identity claim. This is intentional — single-host demo,
no real attack surface. Phase 2 adds gateway-level enforcement via IDP.
See docs/identity-and-audit.md § V1 Security Boundary.
"""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

router = APIRouter(prefix="/auth", tags=["auth"])

_ROLES: dict[str, dict] = {
    "builder": {
        "identity": "user:builder@atom.io",
        "display_name": "Builder",
    },
    "approver": {
        "identity": "user:approver@atom.io",
        "display_name": "Approver",
    },
    "platform_admin": {
        "identity": "user:admin@atom.io",
        "display_name": "Platform Admin",
    },
}


class LoginRequest(BaseModel):
    role: str


@router.post("/login")
def login(req: LoginRequest, response: Response):
    if req.role not in _ROLES:
        raise HTTPException(400, f"Unknown role: {req.role!r}")
    info = _ROLES[req.role]
    response.set_cookie(
        "atom_session", req.role,
        httponly=False, samesite="lax", max_age=86_400,
    )
    return {"role": req.role, **info}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("atom_session")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    role = request.cookies.get("atom_session")
    if not role or role not in _ROLES:
        raise HTTPException(401, "No session")
    return {"role": role, **_ROLES[role]}
