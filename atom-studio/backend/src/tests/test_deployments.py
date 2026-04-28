"""Tests for deployments router and service."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from atom_studio.auth.service import create_access_token

from .conftest import make_mock_conn, mock_get_conn_factory

USER_ID = str(uuid.uuid4())
AGENT_ID = str(uuid.uuid4())
DEPLOYMENT_ID = str(uuid.uuid4())


def _token(role: str = "developer") -> str:
    return create_access_token(USER_ID, role)


def _deployment_row(**kwargs) -> dict:
    base = {
        "id": DEPLOYMENT_ID,
        "agent_id": AGENT_ID,
        "version": 1,
        "status": "pending",
        "submitted_by": USER_ID,
        "approved_by": None,
        "manifest_json": {
            "image": "registry/agent:abc123",
            "git_sha": "abc123",
            "message": "deploy",
        },
        "deployed_at": None,
        "created_at": "2024-01-01T00:00:00",
    }
    return {**base, **kwargs}


def _mock_http() -> MagicMock:
    http = AsyncMock()
    http.__aenter__ = AsyncMock(return_value=http)
    http.__aexit__ = AsyncMock(return_value=None)
    http.post = AsyncMock(return_value=MagicMock(raise_for_status=MagicMock()))
    return http


# ── POST /api/deployments/{agent_id} ─────────────────────────────────────────


async def test_submit_deployment(client):
    mock_conn = make_mock_conn()
    # Sequence of fetchrow calls:
    # 1. agent exists check (router)
    # 2. deployment INSERT (submit_deployment)
    # 3. hitl INSERT (create_hitl_request)
    mock_conn.fetchrow.side_effect = [
        {"id": AGENT_ID},
        _deployment_row(),
        {
            "id": str(uuid.uuid4()),
            "agent_id": AGENT_ID,
            "workflow_type": "DEPLOYMENT_APPROVAL",
            "payload": {},
            "status": "pending",
            "expires_at": "2099-01-01T00:00:00+00:00",
            "created_at": "2024-01-01T00:00:00",
            "assigned_to": None,
            "decided_by": None,
            "decision_note": None,
            "decided_at": None,
        },
    ]
    mock_conn.fetchval.return_value = "test-agent"
    mock_conn.execute = AsyncMock(return_value=None)

    with (
        patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.hitl.service.manager") as mock_mgr,
    ):
        mock_mgr.broadcast = AsyncMock()
        resp = await client.post(
            f"/api/deployments/{AGENT_ID}",
            json={"image": "registry/agent:abc123", "git_sha": "abc123", "message": "deploy"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 201
    assert resp.json()["agent_id"] == AGENT_ID


async def test_submit_deployment_agent_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            f"/api/deployments/{AGENT_ID}",
            json={"image": "registry/agent:abc123"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404


async def test_submit_deployment_requires_auth(client):
    resp = await client.post(
        f"/api/deployments/{AGENT_ID}",
        json={"image": "registry/agent:abc123"},
    )
    assert resp.status_code == 401


# ── GET /api/deployments/{agent_id} ──────────────────────────────────────────


async def test_list_deployments(client):
    mock_conn = make_mock_conn()
    mock_conn.fetch.return_value = [_deployment_row(), _deployment_row(version=2)]

    with patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/deployments/{AGENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert len(resp.json()) == 2


async def test_list_deployments_requires_auth(client):
    resp = await client.get(f"/api/deployments/{AGENT_ID}")
    assert resp.status_code == 401


# ── GET /api/deployments/{agent_id}/{deployment_id} ──────────────────────────


async def test_get_deployment_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = _deployment_row()

    with patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/deployments/{AGENT_ID}/{DEPLOYMENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == DEPLOYMENT_ID


async def test_get_deployment_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/deployments/{AGENT_ID}/{DEPLOYMENT_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404


# ── POST /api/runtime/deploy-result ──────────────────────────────────────────


async def test_deploy_result_success(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {"agent_id": AGENT_ID}
    mock_conn.execute = AsyncMock(return_value=None)

    with patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            "/api/runtime/deploy-result",
            json={"deployment_id": DEPLOYMENT_ID, "status": "deployed"},
        )

    assert resp.status_code == 200
    assert resp.json()["ok"] is True


async def test_deploy_result_failed(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {"agent_id": AGENT_ID}
    mock_conn.execute = AsyncMock(return_value=None)

    with patch("atom_studio.deployments.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            "/api/runtime/deploy-result",
            json={"deployment_id": DEPLOYMENT_ID, "status": "failed", "error": "OOMKilled"},
        )

    assert resp.status_code == 200


async def test_deploy_result_invalid_status(client):
    resp = await client.post(
        "/api/runtime/deploy-result",
        json={"deployment_id": DEPLOYMENT_ID, "status": "deploying"},
    )
    assert resp.status_code == 400


# ── POST /api/runtime/register ────────────────────────────────────────────────


async def test_runtime_register(client):
    resp = await client.post(
        "/api/runtime/register",
        json={"url": "http://atom-runtime:8090"},
    )
    assert resp.status_code == 200
    assert resp.json()["registered"] == "http://atom-runtime:8090"
