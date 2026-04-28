"""Tests for auth service functions and router endpoints."""

import uuid
from unittest.mock import AsyncMock, patch

import pytest

from .conftest import make_mock_conn, mock_get_conn_factory


# ── Pure service function tests ───────────────────────────────────────────────


def test_hash_and_verify_password():
    from atom_studio.auth.service import hash_password, verify_password

    hashed = hash_password("secret123")
    assert hashed != "secret123"
    assert verify_password("secret123", hashed)
    assert not verify_password("wrong", hashed)


def test_create_and_decode_access_token():
    from atom_studio.auth.service import create_access_token, decode_token

    user_id = str(uuid.uuid4())
    token = create_access_token(user_id, "admin")
    claims = decode_token(token)

    assert claims["sub"] == user_id
    assert claims["role"] == "admin"
    assert claims["type"] == "human"
    assert claims["iss"] == "atom-studio"


def test_decode_invalid_token_raises():
    from atom_studio.auth.service import decode_token

    with pytest.raises(ValueError):
        decode_token("not.a.token")


# ── Router endpoint tests ─────────────────────────────────────────────────────


async def test_healthz(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_register_success(client):
    user_id = str(uuid.uuid4())
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.side_effect = [
        None,  # no existing user
        {
            "id": user_id,
            "email": "alice@example.com",
            "full_name": "Alice",
            "role": "developer",
            "created_at": "2024-01-01T00:00:00",
        },
    ]

    with patch("atom_studio.auth.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            "/api/auth/register",
            json={"email": "alice@example.com", "password": "pass1234", "full_name": "Alice"},
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["user"]["email"] == "alice@example.com"


async def test_register_duplicate_email(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {"id": str(uuid.uuid4())}

    with patch("atom_studio.auth.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            "/api/auth/register",
            json={"email": "dup@example.com", "password": "pass1234"},
        )

    assert resp.status_code == 409


async def test_login_success(client):
    from atom_studio.auth.service import hash_password

    user_id = str(uuid.uuid4())
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {
        "id": user_id,
        "email": "alice@example.com",
        "full_name": "Alice",
        "role": "developer",
        "password_hash": hash_password("pass1234"),
        "is_active": True,
    }
    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock(return_value=True)

    with (
        patch("atom_studio.auth.router.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.auth.service.get_redis", AsyncMock(return_value=mock_redis)),
    ):
        resp = await client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "pass1234"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


async def test_login_wrong_password(client):
    from atom_studio.auth.service import hash_password

    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {
        "id": str(uuid.uuid4()),
        "email": "alice@example.com",
        "full_name": "Alice",
        "role": "developer",
        "password_hash": hash_password("pass1234"),
        "is_active": True,
    }

    with patch("atom_studio.auth.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "wrongpass"},
        )

    assert resp.status_code == 401


async def test_me_requires_auth(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_me_with_valid_token(client):
    from atom_studio.auth.service import create_access_token

    user_id = str(uuid.uuid4())
    token = create_access_token(user_id, "developer")

    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {
        "id": user_id,
        "email": "alice@example.com",
        "full_name": "Alice",
        "role": "developer",
        "created_at": "2024-01-01T00:00:00",
    }

    with patch("atom_studio.auth.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert resp.status_code == 200
    assert resp.json()["email"] == "alice@example.com"
