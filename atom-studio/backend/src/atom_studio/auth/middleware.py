from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from .service import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def require_auth(token: str = Depends(oauth2_scheme)) -> dict:
    try:
        claims = decode_token(token)
    except ValueError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail=str(e))
    if claims.get("type") != "human":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not a human token")
    return claims


async def require_admin(claims: dict = Depends(require_auth)) -> dict:
    if claims.get("role") != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="admin role required")
    return claims
