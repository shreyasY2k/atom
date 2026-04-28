"""Shared test fixtures for atom-studio backend tests."""

import os
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

# Point settings at the real JWT keys before any module import resolves them.
KEYS_DIR = Path(__file__).parents[4] / ".keys"
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("JWT_PRIVATE_KEY_PATH", str(KEYS_DIR / "jwt_private.pem"))
os.environ.setdefault("JWT_PUBLIC_KEY_PATH", str(KEYS_DIR / "jwt_public.pem"))
os.environ.setdefault("ATOM_ENCRYPTION_KEY", "a" * 64)


@pytest.fixture(autouse=True)
def clear_settings_cache():
    from atom_studio.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def make_mock_conn():
    """Return an asyncpg-like mock connection with transaction support."""
    conn = AsyncMock()
    txn = MagicMock()
    txn.__aenter__ = AsyncMock(return_value=txn)
    txn.__aexit__ = AsyncMock(return_value=None)
    conn.transaction = MagicMock(return_value=txn)
    return conn


def mock_get_conn_factory(conn):
    @asynccontextmanager
    async def _get_conn():
        yield conn

    return _get_conn


@pytest.fixture
async def client():
    from atom_studio.main import app

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
