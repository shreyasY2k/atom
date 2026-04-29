"""
E2E test fixtures for ATOM SESSION-15.

Manages kubectl port-forwards for the full stack and provides
session-scoped domain/agent fixtures with guaranteed cleanup.
"""

import os
import secrets
import socket
import subprocess
import time

import httpx
import pytest

# ── Port-forward configuration ─────────────────────────────────────────────────

_FORWARDS = [
    # (name, namespace, svc, local_port, remote_port)
    ("gate",          "atom-system", "svc/gate",            8080, 8080),
    ("atom-studio",   "atom-system", "svc/atom-studio-api", 3001, 3001),
    ("atom-llm",      "atom-system", "svc/atom-llm",        4000, 4000),
    ("postgres",      "atom-infra",  "svc/postgres-postgresql", 5432, 5432),
    ("redpanda",      "atom-infra",  "svc/redpanda",        9092, 9092),
]

GATE_URL   = os.environ.get("ATOM_GATE_URL",   "http://localhost:8080")
STUDIO_URL = os.environ.get("ATOM_STUDIO_URL", "http://localhost:3001")
LLM_URL    = os.environ.get("ATOM_LLM_URL",    "http://localhost:4000")

TEST_EMAIL    = "e2e-test@atom.local"
TEST_PASSWORD = "E2eTest!2025"


def _wait_for_port(host: str, port: int, timeout: int = 30) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(0.5)
    return False


@pytest.fixture(scope="session", autouse=True)
def port_forwards():
    """Start kubectl port-forwards for all ATOM services and tear them down."""
    procs = []
    try:
        for name, ns, svc, local_port, remote_port in _FORWARDS:
            cmd = [
                "kubectl", "port-forward", "-n", ns, svc,
                f"{local_port}:{remote_port}",
            ]
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            procs.append((name, proc))

        # Wait for each port to accept connections.
        for name, ns, svc, local_port, _ in _FORWARDS:
            host = "localhost"
            ok = _wait_for_port(host, local_port, timeout=30)
            if not ok:
                pytest.skip(
                    f"Port-forward {name}:{local_port} did not become ready in 30s — "
                    "is the k8s cluster running? (make infra-up && make k8s-deploy)"
                )

        yield

    finally:
        for name, proc in procs:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


@pytest.fixture(scope="session")
def gate_url():
    return GATE_URL


@pytest.fixture(scope="session")
def studio_url():
    return STUDIO_URL


@pytest.fixture(scope="session")
def llm_url():
    return LLM_URL


# ── Auth helpers ───────────────────────────────────────────────────────────────


def _register_and_login(studio_url: str) -> str:
    """Register (idempotent) + login; return access token."""
    with httpx.Client(base_url=studio_url, timeout=15) as client:
        # Register — ignore 409 (already exists)
        client.post(
            "/api/auth/register",
            json={
                "email": TEST_EMAIL,
                "password": TEST_PASSWORD,
                "full_name": "E2E Test User",
            },
        )
        resp = client.post(
            "/api/auth/login",
            json={"email": TEST_EMAIL, "password": TEST_PASSWORD},
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


# ── Domain fixture ─────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def access_token(studio_url):
    return _register_and_login(studio_url)


@pytest.fixture(scope="session")
def test_domain(studio_url, access_token):
    """Create a domain; delete it at session teardown."""
    headers = {"Authorization": f"Bearer {access_token}"}
    domain_id = None
    with httpx.Client(base_url=studio_url, timeout=15) as client:
        suffix = secrets.token_hex(4)
        try:
            resp = client.post(
                "/api/domains/",
                json={"name": f"e2e-test-{suffix}", "description": "SESSION-15 E2E"},
                headers=headers,
            )
            resp.raise_for_status()
            domain_id = resp.json()["id"]
            yield domain_id
        finally:
            if domain_id:
                try:
                    client.delete(f"/api/domains/{domain_id}", headers=headers)
                except Exception:
                    pass


# ── Agent fixture ──────────────────────────────────────────────────────────────


@pytest.fixture(scope="session")
def test_agent(studio_url, access_token, test_domain):
    """
    Create an agent in test_domain.
    Yields (domain_id, agent_id, agent_jwt).
    Deletes the agent at session teardown.
    """
    headers = {"Authorization": f"Bearer {access_token}"}
    agent_id = None
    with httpx.Client(base_url=studio_url, timeout=30) as client:
        try:
            resp = client.post(
                f"/api/domains/{test_domain}/agents/",
                json={
                    "name": "e2e-echo-agent",
                    "description": "E2E test agent",
                    "allowed_models": ["gemini-2.5-flash"],
                    "rpm_limit": 60,
                },
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            agent_id = data["agent"]["id"]
            agent_jwt = data["token"]
            yield (test_domain, agent_id, agent_jwt)
        finally:
            if agent_id:
                try:
                    client.delete(
                        f"/api/domains/{test_domain}/agents/{agent_id}",
                        headers=headers,
                    )
                except Exception:
                    pass
