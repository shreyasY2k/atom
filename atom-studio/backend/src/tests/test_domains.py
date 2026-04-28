"""Tests for domains router and service."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch


from atom_studio.auth.service import create_access_token

from .conftest import make_mock_conn, mock_get_conn_factory

USER_ID = str(uuid.uuid4())
DOMAIN_ID = str(uuid.uuid4())


def _token(role: str = "developer") -> str:
    return create_access_token(USER_ID, role)


def _domain_row(name: str = "acme", litellm_team_id: str | None = None) -> dict:
    return {
        "id": DOMAIN_ID,
        "name": name,
        "description": "test domain",
        "owner_id": USER_ID,
        "is_active": True,
        "litellm_team_id": litellm_team_id or DOMAIN_ID,
        "created_at": "2024-01-01T00:00:00",
        "agent_count": 0,
    }


# ── Create domain ─────────────────────────────────────────────────────────────


async def test_create_domain_success(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {
        "id": DOMAIN_ID,
        "name": "acme",
        "description": "desc",
        "owner_id": USER_ID,
        "is_active": True,
        "created_at": "2024-01-01T00:00:00",
    }
    mock_conn.execute = AsyncMock(return_value=None)

    provision_resp = MagicMock()
    provision_resp.raise_for_status = MagicMock()
    provision_resp.json = MagicMock(return_value={"team_id": DOMAIN_ID, "team_alias": "acme"})

    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=None)
    mock_http.post = AsyncMock(return_value=provision_resp)

    with (
        patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.domains.service.httpx.AsyncClient", return_value=mock_http),
    ):
        resp = await client.post(
            "/api/domains/",
            json={"name": "acme", "description": "desc"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 201
    data = resp.json()
    assert data["name"] == "acme"
    assert data["litellm_team_id"] == DOMAIN_ID


async def test_create_domain_litellm_failure_returns_502(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {
        "id": DOMAIN_ID,
        "name": "acme",
        "description": None,
        "owner_id": USER_ID,
        "is_active": True,
        "created_at": "2024-01-01T00:00:00",
    }

    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=None)
    mock_http.post = AsyncMock(side_effect=Exception("connection refused"))

    with (
        patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.domains.service.httpx.AsyncClient", return_value=mock_http),
    ):
        resp = await client.post(
            "/api/domains/",
            json={"name": "acme"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 502


# ── List / get domains ────────────────────────────────────────────────────────


async def test_list_domains(client):
    mock_conn = make_mock_conn()
    mock_conn.fetch.return_value = [_domain_row("acme"), _domain_row("beta")]

    with patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            "/api/domains/",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_domains_requires_auth(client):
    resp = await client.get("/api/domains/")
    assert resp.status_code == 401


async def test_get_domain_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = _domain_row()

    with patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/domains/{DOMAIN_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == DOMAIN_ID


async def test_get_domain_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/domains/{DOMAIN_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404


# ── Delete domain ─────────────────────────────────────────────────────────────


async def test_delete_domain_success(client):
    mock_conn = make_mock_conn()
    # First call: SELECT to check active
    # Second call: UPDATE is_active = false
    mock_conn.fetchrow.return_value = {"litellm_team_id": DOMAIN_ID}
    mock_conn.execute = AsyncMock(return_value=None)

    deprov_resp = MagicMock()
    deprov_resp.raise_for_status = MagicMock()

    mock_http = AsyncMock()
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=None)
    mock_http.request = AsyncMock(return_value=deprov_resp)

    with (
        patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.domains.service.httpx.AsyncClient", return_value=mock_http),
    ):
        resp = await client.delete(
            f"/api/domains/{DOMAIN_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 204


async def test_delete_domain_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.domains.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.delete(
            f"/api/domains/{DOMAIN_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404
