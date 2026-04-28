import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from ..config import get_settings
from ..redis_client import get_redis


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(user_id: str, role: str) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "type": "human",
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_expire_minutes)).timestamp()),
        "iss": "atom-studio",
    }
    return jwt.encode(payload, settings.jwt_private_key, algorithm="RS256")


def create_refresh_token() -> str:
    return secrets.token_hex(32)


def _hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def store_refresh_token(token: str, user_id: str) -> None:
    settings = get_settings()
    redis = await get_redis()
    key = f"refresh:{_hash_refresh_token(token)}"
    ttl = settings.refresh_token_expire_days * 86400
    await redis.setex(key, ttl, user_id)


async def validate_refresh_token(token: str) -> str | None:
    redis = await get_redis()
    key = f"refresh:{_hash_refresh_token(token)}"
    return await redis.get(key)


async def revoke_refresh_token(token: str) -> None:
    redis = await get_redis()
    key = f"refresh:{_hash_refresh_token(token)}"
    await redis.delete(key)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_public_key, algorithms=["RS256"])
    except JWTError as e:
        raise ValueError(str(e))
