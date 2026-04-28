"""Shared test fixtures for atom-runtime tests."""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/test")
os.environ.setdefault("ATOM_STUDIO_API_URL", "http://localhost:3001")
os.environ.setdefault("ATOM_RUNTIME_SELF_URL", "http://localhost:8090")
os.environ.setdefault("ATOM_GATE_CLUSTER_URL", "http://host.docker.internal:8080")


@pytest.fixture(autouse=True)
def clear_settings_cache():
    from atom_runtime.config import get_settings

    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def make_mock_k8s_clients():
    apps_v1 = MagicMock()
    core_v1 = MagicMock()
    networking_v1 = MagicMock()
    return apps_v1, core_v1, networking_v1


@pytest.fixture
async def client():
    # Patch k8s config loading and DB pool init so they don't need real services
    with (
        patch("atom_runtime.k8s_client._load_config"),
        patch("atom_runtime.database.init_pool", AsyncMock()),
        patch("atom_runtime.database.close_pool", AsyncMock()),
        patch("atom_runtime.deploy_webhook._register_with_studio", AsyncMock()),
    ):
        from atom_runtime.deploy_webhook import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            yield c
