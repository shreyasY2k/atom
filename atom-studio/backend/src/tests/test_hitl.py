"""Tests for HITL router and service."""

import uuid
from unittest.mock import AsyncMock, patch

from atom_studio.auth.service import create_access_token

from .conftest import make_mock_conn, mock_get_conn_factory

USER_ID = str(uuid.uuid4())
AGENT_ID = str(uuid.uuid4())
HITL_ID = str(uuid.uuid4())


def _token(role: str = "admin") -> str:
    return create_access_token(USER_ID, role)


def _hitl_row(**kwargs) -> dict:
    base = {
        "id": HITL_ID,
        "agent_id": AGENT_ID,
        "workflow_type": "BUSINESS_DECISION",
        "payload": {"action": "approve_loan", "amount": 50000},
        "status": "pending",
        "assigned_to": None,
        "decided_by": None,
        "decision_note": None,
        "expires_at": "2099-01-01T00:00:00+00:00",
        "created_at": "2024-01-01T00:00:00",
        "decided_at": None,
        "agent_name": "test-agent",
    }
    return {**base, **kwargs}


# ── POST /api/hitl/request ────────────────────────────────────────────────────


async def test_create_hitl_request(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = _hitl_row()
    mock_conn.fetchval.return_value = "test-agent"

    with (
        patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.hitl.service.manager") as mock_mgr,
    ):
        mock_mgr.broadcast = AsyncMock()
        resp = await client.post(
            "/api/hitl/request",
            json={
                "agent_id": AGENT_ID,
                "workflow_type": "BUSINESS_DECISION",
                "payload": {"action": "approve_loan"},
                "timeout_s": 300,
            },
        )

    assert resp.status_code == 201
    assert "hitl_id" in resp.json()


async def test_create_hitl_request_no_auth_required(client):
    """POST /api/hitl/request is a network-internal endpoint — no auth needed."""
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = _hitl_row()
    mock_conn.fetchval.return_value = "agent"

    with (
        patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.hitl.service.manager") as mock_mgr,
    ):
        mock_mgr.broadcast = AsyncMock()
        resp = await client.post(
            "/api/hitl/request",
            json={
                "agent_id": AGENT_ID,
                "workflow_type": "BUSINESS_DECISION",
                "payload": {},
                "timeout_s": 60,
            },
        )

    assert resp.status_code == 201


# ── GET /api/hitl/queue ───────────────────────────────────────────────────────


async def test_get_queue_admin(client):
    mock_conn = make_mock_conn()
    mock_conn.fetch.return_value = [_hitl_row()]

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            "/api/hitl/queue",
            headers={"Authorization": f"Bearer {_token('admin')}"},
        )

    assert resp.status_code == 200
    assert len(resp.json()) == 1


async def test_get_queue_requires_auth(client):
    resp = await client.get("/api/hitl/queue")
    assert resp.status_code == 401


async def test_get_queue_developer_scoped(client):
    """Developer sees only their agents' HITL items."""
    mock_conn = make_mock_conn()
    mock_conn.fetch.return_value = []

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            "/api/hitl/queue",
            headers={"Authorization": f"Bearer {_token('developer')}"},
        )

    assert resp.status_code == 200


# ── GET /api/hitl/history ─────────────────────────────────────────────────────


async def test_get_history(client):
    mock_conn = make_mock_conn()
    mock_conn.fetch.return_value = [_hitl_row(status="approved")]

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            "/api/hitl/history",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()[0]["status"] == "approved"


# ── GET /api/hitl/{id} ────────────────────────────────────────────────────────


async def test_get_hitl_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = _hitl_row()

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/hitl/{HITL_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()["id"] == HITL_ID


async def test_get_hitl_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.get(
            f"/api/hitl/{HITL_ID}",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404


# ── POST /api/hitl/{id}/decide ────────────────────────────────────────────────


async def test_decide_approve(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.side_effect = [
        {"status": "pending"},  # status check
        {"workflow_type": "BUSINESS_DECISION", "payload": {}},  # decide → check type
    ]
    mock_conn.execute = AsyncMock(return_value=None)

    with (
        patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.hitl.service.manager") as mock_mgr,
        patch("atom_studio.hitl.service.get_conn", mock_get_conn_factory(mock_conn)),
    ):
        mock_mgr.broadcast = AsyncMock()
        resp = await client.post(
            f"/api/hitl/{HITL_ID}/decide",
            json={"approved": True, "note": "Looks good"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


async def test_decide_reject(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.side_effect = [
        {"status": "pending"},
        {"workflow_type": "BUSINESS_DECISION", "payload": {}},
    ]
    mock_conn.execute = AsyncMock(return_value=None)

    with (
        patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)),
        patch("atom_studio.hitl.service.manager") as mock_mgr,
        patch("atom_studio.hitl.service.get_conn", mock_get_conn_factory(mock_conn)),
    ):
        mock_mgr.broadcast = AsyncMock()
        resp = await client.post(
            f"/api/hitl/{HITL_ID}/decide",
            json={"approved": False, "note": "Not approved"},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"


async def test_decide_already_decided(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = {"status": "approved"}

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            f"/api/hitl/{HITL_ID}/decide",
            json={"approved": True},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 409


async def test_decide_not_found(client):
    mock_conn = make_mock_conn()
    mock_conn.fetchrow.return_value = None

    with patch("atom_studio.hitl.router.get_conn", mock_get_conn_factory(mock_conn)):
        resp = await client.post(
            f"/api/hitl/{HITL_ID}/decide",
            json={"approved": True},
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert resp.status_code == 404
