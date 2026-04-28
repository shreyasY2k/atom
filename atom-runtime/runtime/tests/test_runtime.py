"""Tests for atom-runtime deploy webhook and manifest builder."""

import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

from kubernetes import client as k8s
from kubernetes.client.exceptions import ApiException

from atom_runtime.manifest_builder import (
    build_deployment,
    build_jwt_secret,
    build_network_policy,
    build_service,
    cluster_service_dns,
    jwt_secret_name,
    resource_name,
)

AGENT_ID = str(uuid.uuid4())
DOMAIN_ID = str(uuid.uuid4())
DEPLOYMENT_ID = str(uuid.uuid4())
NAMESPACE = "atom-agents"
GATE_NS = "atom-system"


# ── helpers ───────────────────────────────────────────────────────────────────


def _make_conn():
    conn = AsyncMock()
    conn.execute = AsyncMock(return_value=None)
    conn.fetchrow = AsyncMock(return_value=None)
    conn.fetchval = AsyncMock(return_value=None)
    return conn


def _mock_get_conn_factory(conn):
    @asynccontextmanager
    async def _get_conn():
        yield conn

    return _get_conn


def _fast_settings_mock(timeout=1, interval=1):
    s = MagicMock()
    s.agent_namespace = NAMESPACE
    s.gate_namespace = GATE_NS
    s.atom_gate_cluster_url = "http://gate:8080"
    s.atom_studio_api_url = "http://localhost:3001"
    s.pod_ready_timeout_s = timeout
    s.pod_poll_interval_s = interval
    return s


# ── manifest_builder unit tests ───────────────────────────────────────────────


def test_resource_name():
    assert resource_name(AGENT_ID) == f"agent-{AGENT_ID}"


def test_jwt_secret_name():
    assert jwt_secret_name(AGENT_ID) == f"agent-jwt-{AGENT_ID}"


def test_cluster_service_dns():
    dns = cluster_service_dns(AGENT_ID, NAMESPACE)
    assert dns == f"agent-{AGENT_ID}.{NAMESPACE}.svc.cluster.local"


def test_build_jwt_secret_structure():
    secret = build_jwt_secret(AGENT_ID, "test-jwt-value", NAMESPACE)
    assert isinstance(secret, k8s.V1Secret)
    assert secret.metadata.name == jwt_secret_name(AGENT_ID)
    assert secret.metadata.namespace == NAMESPACE
    assert secret.string_data["ATOM_AGENT_JWT"] == "test-jwt-value"
    assert secret.metadata.labels["atom.io/managed-by"] == "atom-runtime"


def test_build_deployment_structure():
    dep = build_deployment(
        agent_id=AGENT_ID,
        domain_id=DOMAIN_ID,
        deployment_id=DEPLOYMENT_ID,
        image="nginx:alpine",
        gate_url="http://gate.atom-system.svc.cluster.local:8080",
        namespace=NAMESPACE,
    )
    assert isinstance(dep, k8s.V1Deployment)
    assert dep.metadata.name == resource_name(AGENT_ID)
    assert dep.metadata.namespace == NAMESPACE
    assert dep.spec.replicas == 1
    assert dep.spec.selector.match_labels["atom.io/agent-id"] == AGENT_ID
    assert dep.metadata.annotations["atom.io/deployment-id"] == DEPLOYMENT_ID

    container = dep.spec.template.spec.containers[0]
    assert container.image == "nginx:alpine"
    assert container.name == "agent"

    gate_env = next(e for e in container.env if e.name == "ATOM_GATE_URL")
    assert gate_env.value == "http://gate.atom-system.svc.cluster.local:8080"

    jwt_env = next(e for e in container.env if e.name == "ATOM_AGENT_JWT")
    assert jwt_env.value_from.secret_key_ref.name == jwt_secret_name(AGENT_ID)
    assert jwt_env.value_from.secret_key_ref.key == "ATOM_AGENT_JWT"

    agent_id_env = next(e for e in container.env if e.name == "ATOM_AGENT_ID")
    assert agent_id_env.value == AGENT_ID


def test_build_deployment_security_context():
    dep = build_deployment(
        agent_id=AGENT_ID,
        domain_id=DOMAIN_ID,
        deployment_id=DEPLOYMENT_ID,
        image="nginx:alpine",
        gate_url="http://gate:8080",
        namespace=NAMESPACE,
    )
    sc = dep.spec.template.spec.security_context
    assert sc.run_as_non_root is True
    assert sc.run_as_user == 1000


def test_build_deployment_custom_resources():
    dep = build_deployment(
        agent_id=AGENT_ID,
        domain_id=DOMAIN_ID,
        deployment_id=DEPLOYMENT_ID,
        image="nginx:alpine",
        gate_url="http://gate:8080",
        namespace=NAMESPACE,
        cpu_request="200m",
        cpu_limit="1000m",
        mem_request="512Mi",
        mem_limit="1Gi",
    )
    res = dep.spec.template.spec.containers[0].resources
    assert res.requests["cpu"] == "200m"
    assert res.limits["memory"] == "1Gi"


def test_build_service_structure():
    svc = build_service(AGENT_ID, NAMESPACE)
    assert isinstance(svc, k8s.V1Service)
    assert svc.metadata.name == resource_name(AGENT_ID)
    assert svc.metadata.namespace == NAMESPACE
    assert svc.spec.type == "ClusterIP"
    assert svc.spec.selector["atom.io/agent-id"] == AGENT_ID
    assert svc.spec.ports[0].port == 8080


def test_build_network_policy_structure():
    netpol = build_network_policy(AGENT_ID, NAMESPACE, GATE_NS)
    assert isinstance(netpol, dict)
    assert netpol["kind"] == "NetworkPolicy"
    assert netpol["metadata"]["namespace"] == NAMESPACE
    assert netpol["metadata"]["name"] == f"agent-{AGENT_ID}-ingress"

    ingress_rule = netpol["spec"]["ingress"][0]
    from_rule = ingress_rule["from"][0]
    assert from_rule["namespaceSelector"]["matchLabels"]["kubernetes.io/metadata.name"] == GATE_NS
    assert from_rule["podSelector"]["matchLabels"]["app"] == "gate"
    assert ingress_rule["ports"][0]["port"] == 8080


# ── Endpoint tests ────────────────────────────────────────────────────────────


async def test_healthz(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


async def test_deploy_accepted(client):
    with patch("atom_runtime.deploy_webhook.run_deployment", AsyncMock()):
        resp = await client.post(
            "/runtime/deploy",
            json={
                "deployment_id": DEPLOYMENT_ID,
                "agent_id": AGENT_ID,
                "domain_id": DOMAIN_ID,
                "image": "nginx:alpine",
                "agent_jwt": "test-jwt",
            },
        )
    assert resp.status_code == 202
    data = resp.json()
    assert data["deployment_id"] == DEPLOYMENT_ID
    assert data["accepted"] is True


async def test_deploy_missing_fields_returns_422(client):
    resp = await client.post(
        "/runtime/deploy",
        json={"deployment_id": DEPLOYMENT_ID},
    )
    assert resp.status_code == 422


async def test_rollback_accepted(client):
    with patch("atom_runtime.deploy_webhook.run_rollback", AsyncMock()):
        resp = await client.post(f"/runtime/rollback/{DEPLOYMENT_ID}")
    assert resp.status_code == 202
    assert resp.json()["deployment_id"] == DEPLOYMENT_ID


# ── run_deployment integration tests (fully mocked) ──────────────────────────


async def test_run_deployment_pod_becomes_ready():
    from atom_runtime.deploy_webhook import DeployRequest, run_deployment

    req = DeployRequest(
        deployment_id=DEPLOYMENT_ID,
        agent_id=AGENT_ID,
        domain_id=DOMAIN_ID,
        image="nginx:alpine",
        agent_jwt="test-jwt",
    )

    apps_v1 = MagicMock()
    core_v1 = MagicMock()
    networking_v1 = MagicMock()

    ready_pod = MagicMock()
    ready_pod.status.conditions = [MagicMock(type="Ready", status="True")]
    core_v1.list_namespaced_pod.return_value = MagicMock(items=[ready_pod])

    mock_conn = _make_conn()

    with (
        patch(
            "atom_runtime.deploy_webhook.get_k8s_clients",
            return_value=(apps_v1, core_v1, networking_v1),
        ),
        patch("atom_runtime.deploy_webhook.get_conn", _mock_get_conn_factory(mock_conn)),
        patch("atom_runtime.deploy_webhook._notify_studio", AsyncMock()) as mock_notify,
        patch("atom_runtime.deploy_webhook.get_settings", return_value=_fast_settings_mock()),
    ):
        await run_deployment(req)

    mock_notify.assert_awaited_once_with(DEPLOYMENT_ID, "deployed", None)
    apps_v1.create_namespaced_deployment.assert_called_once()
    core_v1.create_namespaced_service.assert_called_once()
    core_v1.create_namespaced_secret.assert_called_once()
    networking_v1.create_namespaced_network_policy.assert_called_once()


async def test_run_deployment_pod_not_ready_marks_failed():
    from atom_runtime.deploy_webhook import DeployRequest, run_deployment

    req = DeployRequest(
        deployment_id=DEPLOYMENT_ID,
        agent_id=AGENT_ID,
        domain_id=DOMAIN_ID,
        image="nginx:alpine",
        agent_jwt="test-jwt",
    )

    apps_v1 = MagicMock()
    core_v1 = MagicMock()
    networking_v1 = MagicMock()

    not_ready_pod = MagicMock()
    not_ready_pod.status.conditions = []
    core_v1.list_namespaced_pod.return_value = MagicMock(items=[not_ready_pod])

    mock_conn = _make_conn()

    with (
        patch(
            "atom_runtime.deploy_webhook.get_k8s_clients",
            return_value=(apps_v1, core_v1, networking_v1),
        ),
        patch("atom_runtime.deploy_webhook.get_conn", _mock_get_conn_factory(mock_conn)),
        patch("atom_runtime.deploy_webhook._notify_studio", AsyncMock()) as mock_notify,
        patch("atom_runtime.deploy_webhook.get_settings", return_value=_fast_settings_mock()),
    ):
        await run_deployment(req)

    mock_notify.assert_awaited_once_with(
        DEPLOYMENT_ID, "failed", "Pod did not become Ready within timeout"
    )


async def test_run_deployment_k8s_conflict_updates_existing():
    """A 409 on create triggers a replace — no exception propagated."""
    from atom_runtime.deploy_webhook import DeployRequest, run_deployment

    req = DeployRequest(
        deployment_id=DEPLOYMENT_ID,
        agent_id=AGENT_ID,
        domain_id=DOMAIN_ID,
        image="nginx:alpine",
        agent_jwt="test-jwt",
    )

    apps_v1 = MagicMock()
    apps_v1.create_namespaced_deployment.side_effect = ApiException(status=409)
    apps_v1.replace_namespaced_deployment.return_value = MagicMock()

    core_v1 = MagicMock()
    networking_v1 = MagicMock()

    ready_pod = MagicMock()
    ready_pod.status.conditions = [MagicMock(type="Ready", status="True")]
    core_v1.list_namespaced_pod.return_value = MagicMock(items=[ready_pod])

    mock_conn = _make_conn()

    with (
        patch(
            "atom_runtime.deploy_webhook.get_k8s_clients",
            return_value=(apps_v1, core_v1, networking_v1),
        ),
        patch("atom_runtime.deploy_webhook.get_conn", _mock_get_conn_factory(mock_conn)),
        patch("atom_runtime.deploy_webhook._notify_studio", AsyncMock()) as mock_notify,
        patch("atom_runtime.deploy_webhook.get_settings", return_value=_fast_settings_mock()),
    ):
        await run_deployment(req)

    apps_v1.replace_namespaced_deployment.assert_called_once()
    mock_notify.assert_awaited_once_with(DEPLOYMENT_ID, "deployed", None)


async def test_run_rollback_no_previous_version():
    from atom_runtime.deploy_webhook import run_rollback

    mock_conn = _make_conn()
    mock_conn.fetchrow.side_effect = [
        {"agent_id": AGENT_ID, "manifest_json": {"image": "nginx:v2"}},  # current
        None,  # no previous deployed version
    ]

    with (
        patch("atom_runtime.deploy_webhook.get_conn", _mock_get_conn_factory(mock_conn)),
        patch("atom_runtime.deploy_webhook._notify_studio", AsyncMock()) as mock_notify,
        patch("atom_runtime.deploy_webhook.get_settings", return_value=_fast_settings_mock()),
    ):
        await run_rollback(DEPLOYMENT_ID)

    mock_notify.assert_awaited_once_with(
        DEPLOYMENT_ID, "failed", "No previous deployed version found"
    )


async def test_run_rollback_applies_previous_image():
    from atom_runtime.deploy_webhook import run_rollback

    mock_conn = _make_conn()
    mock_conn.fetchrow.side_effect = [
        {"agent_id": AGENT_ID, "manifest_json": {"image": "nginx:v2"}},
        {"id": str(uuid.uuid4()), "manifest_json": {"image": "nginx:v1"}},
    ]

    apps_v1 = MagicMock()
    _, core_v1, networking_v1 = MagicMock(), MagicMock(), MagicMock()

    with (
        patch(
            "atom_runtime.deploy_webhook.get_k8s_clients",
            return_value=(apps_v1, core_v1, networking_v1),
        ),
        patch("atom_runtime.deploy_webhook.get_conn", _mock_get_conn_factory(mock_conn)),
        patch("atom_runtime.deploy_webhook._notify_studio", AsyncMock()) as mock_notify,
        patch("atom_runtime.deploy_webhook.get_settings", return_value=_fast_settings_mock()),
    ):
        await run_rollback(DEPLOYMENT_ID)

    patch_call = apps_v1.patch_namespaced_deployment.call_args
    container_image = patch_call[0][2]["spec"]["template"]["spec"]["containers"][0]["image"]
    assert container_image == "nginx:v1"
    mock_notify.assert_awaited_once_with(DEPLOYMENT_ID, "rolled_back", None)
