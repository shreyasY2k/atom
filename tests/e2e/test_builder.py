"""End-to-end tests for the Agent Builder backend."""

import httpx
import pytest

from conftest import BUILDER_URL


@pytest.fixture(scope="module")
def client():
    return httpx.Client(base_url=BUILDER_URL, timeout=30)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_registry_empty_or_list(client):
    r = client.get("/registry")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)


def test_spec_list(client):
    r = client.get("/specs")
    assert r.status_code == 200


def test_agents_list(client):
    r = client.get("/agents")
    assert r.status_code == 200
    data = r.json()
    assert "agents" in data or isinstance(data, list)


def test_spec_validate_minimal(client):
    """POST a minimal valid spec and expect either success or a validation error list."""
    spec = {
        "apiVersion": "atom.platform/v1",
        "kind": "AgentDeployment",
        "metadata": {
            "name": "test-agent",
            "domain": "test-domain",
            "version": "1.0.0",
            "description": "A test agent",
            "owner": "user:test@example.com",
        },
        "spec": {
            "agents": [
                {
                    "name": "test-agent",
                    "role": "standalone",
                    "reasoning_mode": "prescribed",
                    "model": "gemini-3.1-pro",
                    "temperature": 1.0,
                    "reasoning_effort": "medium",
                    "max_iterations": 6,
                    "tools": [],
                    "memory": {"type": "short_term"},
                    "input_schema": {},
                }
            ],
            "flow": {"type": "standalone"},
            "audit": {"log_to": "minio://audit-logs/agent/test", "retention_days": 90},
            "deployment": {"runtime": "agentscope", "sandbox": "base", "replicas": 1},
        },
    }
    r = client.post("/specs/validate", json=spec)
    assert r.status_code in (200, 422)


def test_deployment_list(client):
    r = client.get("/deployments")
    assert r.status_code == 200


def test_auth_roles(client):
    r = client.get("/auth/roles")
    assert r.status_code == 200


def test_runs_list(client):
    r = client.get("/agents/runs")
    assert r.status_code in (200, 404)
