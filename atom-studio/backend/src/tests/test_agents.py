"""Tests for agents router and service."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from atom_studio.auth.service import create_access_token

from .conftest import make_mock_conn, mock_get_conn_factory

USER_ID = str(uuid.uuid4())
DOMAIN_ID = str(uuid.uuid4())
AGENT_ID = str(uuid.uuid4())


def _token(role: str = "developer") -> str:
    return create_access_token(USER_ID, role)


def _agent_row(**kwargs) -> dict:
    base = {
        "id": AGENT_ID,
        "domain_id": DOMAIN_ID,
        "owner_id": USER_ID,
        "name": "test-agent",
        "description": None,
        "status": "draft",
        "allowed_models": ["gemini-2.5-flash"],
        "rpm_limit": 60,
        "tpm_limit": 100000,
        "hitl_timeout_seconds": 300,
        "hitl_fallback": "ABORT",
        "litellm_agent_id": None,
        "litellm_virtual_key": None,
        "memory_config_id": None,
        "cluster_service_name": None,
        "created_at": "2024-01-01T00:00:00",
        "updated_at": "2024-01-01T00:00:00",
    }
    return {**base, **kwargs}


def _litellm_provision_resp() -> MagicMock:
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(
        return_value={"litellm_agent_id": "key-abc123", "virtual_key": "sk-fake-virtual-key"}
    )
    return resp


def _mock_http(post_resp=None, delete_resp=None) -> AsyncMock:
    http = AsyncMock()
    http.__aenter__ = AsyncMock(return_value=http)
    http.__aexit__ = AsyncMock(return_value=None)
    if post_resp is not None:
        http.post = AsyncMock(return_value=post_resp)
    if delete_resp is not None:
        dr = MagicMock()
        dr.raise_for_status = MagicMock()
        http.request = AsyncMock(return_value=dr)
    return http


# ── create agent ──────────────────────────────────────────────────────────────


async def test_create_agent_success(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.side_effect = [
        {"id": DOMAIN_ID, "litellm_team_id": DOMAIN_ID},  # domain check
        _agent_row(),  # agent INSERT
    ]
    mock_conn.execute = AsyncMock(return_value=None)

    mock_redis = AsyncMock()
    mock_http = _mock_http(post_resp=_litellm_provision_resp())

    with (
        patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.agents.service.httpx.AsyncClient", return_value=mock_http),
        patch("atom_studio.agents.service.get_redis", AsyncMock(return_value=mock_redis)),
    ):
        resp = await client.post(
            f"/api/domains/{DOMAIN_ID}/agents/",
            json={"name": "test-agent", "allowed_models": ["gemini-2.5-flash"]},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 201
    data = resp.json()
    assert "token" in data
    assert data["agent"]["name"] == "test-agent"
    assert data["agent"]["litellm_agent_id"] == "key-abc123"
    assert "litellm_virtual_key" not in data["agent"]


async def test_create_agent_requires_auth(client):
    resp = await client.post(
        f"/api/domains/{DOMAIN_ID}/agents/",
        json={"name": "x"},
    )
    assert resp.status_code == 401


async def test_create_agent_domain_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None  # domain not found

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            f"/api/domains/{DOMAIN_ID}/agents/",
            json={"name": "test-agent"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 400
    assert "Domain not found" in resp.json()["detail"]


async def test_create_agent_no_litellm_team(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {"id": DOMAIN_ID, "litellm_team_id": None}

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            f"/api/domains/{DOMAIN_ID}/agents/",
            json={"name": "test-agent"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 400
    assert "no LiteLLM team" in resp.json()["detail"]


async def test_create_agent_litellm_failure_returns_502(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.side_effect = [
        {"id": DOMAIN_ID, "litellm_team_id": DOMAIN_ID},
        _agent_row(),
    ]
    mock_conn.execute = AsyncMock(return_value=None)

    mock_http = _mock_http()
    mock_http.post = AsyncMock(side_effect=Exception("connection refused"))

    with (
        patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.agents.service.httpx.AsyncClient", return_value=mock_http),
    ):
        resp = await client.post(
            f"/api/domains/{DOMAIN_ID}/agents/",
            json={"name": "test-agent"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 502


# ── list / get agents ─────────────────────────────────────────────────────────


async def test_list_agents(client):
    mock_conn = make_mock_conn()
    mock_conn.fetch.return_value = [
        {**_agent_row(), "tool_count": 0, "skill_count": 0},
    ]

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/domains/{DOMAIN_ID}/agents/",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_agent_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = _agent_row(litellm_virtual_key="encrypted")
    mock_conn.fetch.return_value = []  # no tools/skills

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/domains/{DOMAIN_ID}/agents/{AGENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == AGENT_ID
    assert "litellm_virtual_key" not in resp.json()


async def test_get_agent_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/domains/{DOMAIN_ID}/agents/{AGENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404


# ── delete agent ──────────────────────────────────────────────────────────────


async def test_delete_agent_success(client):
    mock_conn = make_mock_conn()
    # First fetchrow: for delete_agent (no virtual key → skip deprovision)
    # Second fetchrow: for get_agent (inside regenerate check)
    mock_conn.fetchrow.side_effect = [
        {"litellm_virtual_key": None},  # delete_agent lookup
    ]
    mock_conn.execute = AsyncMock(return_value=None)

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.delete(
            f"/api/domains/{DOMAIN_ID}/agents/{AGENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 204


async def test_delete_agent_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.delete(
            f"/api/domains/{DOMAIN_ID}/agents/{AGENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404


# ── regenerate token ──────────────────────────────────────────────────────────


async def test_regenerate_token(client):
    mock_conn = make_mock_conn()
    # regenerate_token uses conn.fetch (not fetchrow) for old tokens, so
    # fetchrow is called twice: once for get_agent, once for the domain_id lookup.
    mock_conn.fetchrow.side_effect = [
        _agent_row(),  # get_agent
        {"domain_id": DOMAIN_ID},  # agent domain_id lookup in regenerate_token
    ]
    # fetch returns [] for tools/skills (get_agent) and [] for old_clients (no revocation)
    mock_conn.fetch.return_value = []
    mock_conn.execute = AsyncMock(return_value=None)

    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)

    with (
        patch("atom_studio.agents.service.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.agents.service.get_redis", AsyncMock(return_value=mock_redis)),
    ):
        resp = await client.post(
            f"/api/domains/{DOMAIN_ID}/agents/{AGENT_ID}/regenerate-token",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert len(data["token"]) > 50
