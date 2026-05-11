"""End-to-end tests for the Workflow Engine backend."""

import httpx
import pytest

from conftest import WORKFLOW_URL


@pytest.fixture(scope="module")
def client():
    return httpx.Client(base_url=WORKFLOW_URL, timeout=30)


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_workflows_list(client):
    r = client.get("/workflows")
    assert r.status_code == 200
    data = r.json()
    assert "workflows" in data or isinstance(data, list)


def test_runs_list(client):
    r = client.get("/runs")
    assert r.status_code == 200


def test_tasks_list(client):
    r = client.get("/tasks")
    assert r.status_code == 200


def test_audit_events(client):
    r = client.get("/audit/events")
    assert r.status_code == 200


def test_workflow_spec_validate_minimal(client):
    """Validate a minimal workflow spec."""
    spec = {
        "apiVersion": "atom.platform/v1",
        "kind": "WorkflowDeployment",
        "metadata": {
            "name": "test-workflow",
            "domain": "test-domain",
            "version": "1.0.0",
            "description": "A test workflow",
        },
        "spec": {
            "nodes": [
                {
                    "id": "start",
                    "type": "human_task",
                    "label": "Start Review",
                    "assignee_group": "ops",
                    "next": None,
                }
            ],
            "entry": "start",
        },
    }
    r = client.post("/specs/validate", json=spec)
    assert r.status_code in (200, 422)


def test_workflow_deployments_list(client):
    r = client.get("/deployments")
    assert r.status_code == 200


def test_audit_identities(client):
    r = client.get("/audit/identities")
    assert r.status_code in (200, 404)
