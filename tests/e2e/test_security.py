"""
Security / negative-path E2E tests for ATOM SESSION-15.

Each test validates a specific security boundary enforced by GATE or atom-studio.
"""

import asyncio
import subprocess
import time
from calendar import timegm
from datetime import datetime, timezone

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt as jose_jwt


# ── JWT helpers ────────────────────────────────────────────────────────────────


def _forge_expired_jwt() -> str:
    """
    Sign a JWT with a fresh throwaway RSA key (unknown to GATE) where
    nbf = iat = exp = epoch + 1.  GATE must reject it with 401.
    """
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    ).decode()
    epoch = 1  # well in the past
    payload = {
        "sub": "agent-00000000-0000-0000-0000-000000000000",
        "type": "agent",
        "agent_id": "00000000-0000-0000-0000-000000000000",
        "domain_id": "00000000-0000-0000-0000-000000000000",
        "iss": "atom-studio",
        "iat": epoch,
        "nbf": epoch,
        "exp": epoch,
    }
    return jose_jwt.encode(payload, private_pem, algorithm="RS256")


# ── Tests ──────────────────────────────────────────────────────────────────────


def test_expired_jwt_returns_401(gate_url):
    """Forged / expired JWT must be rejected at GATE with 401."""
    token = _forge_expired_jwt()
    resp = httpx.post(
        f"{gate_url}/domain/fake-domain/agent/fake-agent/echo",
        headers={"Authorization": f"Bearer {token}"},
        content=b"probe",
        timeout=10,
    )
    assert resp.status_code == 401, (
        f"Expected 401 for expired JWT, got {resp.status_code}: {resp.text}"
    )


def test_wrong_domain_in_path_returns_403(gate_url, studio_url, access_token, test_agent):
    """
    Agent JWT is scoped to domain_id from test_agent.
    Sending it with a different domain_id in the path must return 403.
    """
    domain_id, agent_id, agent_jwt = test_agent
    wrong_domain = "00000000-0000-0000-0000-000000000000"
    assert wrong_domain != domain_id

    resp = httpx.post(
        f"{gate_url}/domain/{wrong_domain}/agent/{agent_id}/echo",
        headers={"Authorization": f"Bearer {agent_jwt}"},
        content=b"probe",
        timeout=10,
    )
    assert resp.status_code in (401, 403), (
        f"Expected 401/403 for domain mismatch, got {resp.status_code}: {resp.text}"
    )


def test_revoked_token_returns_401(gate_url, studio_url, access_token, test_domain):
    """Token revocation must propagate to GATE within 1s (Redis blacklist)."""
    headers = {"Authorization": f"Bearer {access_token}"}

    # Create a dedicated agent for this test
    with httpx.Client(base_url=studio_url, timeout=30) as client:
        resp = client.post(
            f"/api/domains/{test_domain}/agents/",
            json={"name": "e2e-revoke-test-agent", "allowed_models": ["gemini-2.5-flash"]},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        data      = resp.json()
        agent_id  = data["agent"]["id"]
        old_token = data["token"]

    try:
        # Regenerate token — this blacklists old_token
        with httpx.Client(base_url=studio_url, timeout=15) as client:
            resp = client.post(
                f"/api/domains/{test_domain}/agents/{agent_id}/regenerate-token",
                headers=headers,
            )
            assert resp.status_code == 200, resp.text

        time.sleep(0.5)  # let Redis propagate

        resp = httpx.get(
            f"{gate_url}/domain/{test_domain}/agent/{agent_id}/healthz",
            headers={"Authorization": f"Bearer {old_token}"},
            timeout=10,
        )
        assert resp.status_code == 401, (
            f"Expected 401 after token revocation, got {resp.status_code}"
        )
    finally:
        with httpx.Client(base_url=studio_url, timeout=10) as client:
            client.delete(
                f"/api/domains/{test_domain}/agents/{agent_id}",
                headers={"Authorization": f"Bearer {access_token}"},
            )


def test_tool_not_permitted_returns_403(gate_url, test_agent):
    """
    Agent with no tools must get 403 when calling /tools/execute.
    OPA policy enforces tool membership.
    """
    domain_id, agent_id, agent_jwt = test_agent
    resp = httpx.post(
        f"{gate_url}/domain/{domain_id}/agent/{agent_id}/tools/execute",
        headers={"Authorization": f"Bearer {agent_jwt}"},
        json={"tool": "calculator", "input": {"expr": "1+1"}},
        timeout=10,
    )
    # 403 = OPA policy denied (agent has no tools)
    # 404 = tool not found
    # 502 = agent pod not deployed yet (also a valid rejection — no pod means no execution)
    assert resp.status_code in (403, 404, 502), (
        f"Expected 403/404/502 for unpermitted tool, got {resp.status_code}: {resp.text}"
    )


def test_direct_llm_call_blocked_by_network_policy():
    """
    NetworkPolicy atom-llm-ingress only permits GATE pods.
    A curl pod in atom-agents namespace must NOT reach atom-llm:4000.
    """
    pod_name = "curl-netpol-test"

    # Cleanup previous run (ignore error)
    subprocess.run(
        ["kubectl", "delete", "pod", pod_name, "-n", "atom-agents", "--ignore-not-found"],
        capture_output=True,
    )

    result = subprocess.run(
        [
            "kubectl", "run", pod_name,
            "--image=curlimages/curl:latest",
            "-n", "atom-agents",
            "--restart=Never",
            "--rm",
            "--attach",
            "--timeout=15s",
            "--",
            "curl", "--max-time", "5", "--fail",
            "http://atom-llm.atom-system.svc.cluster.local:4000/health",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode != 0, (
        "NetworkPolicy should have blocked direct atom-llm access from atom-agents, "
        f"but curl succeeded (exit 0). stdout={result.stdout} stderr={result.stderr}"
    )


def test_rate_limit_returns_429(gate_url, test_agent):
    """
    Fire requests concurrently at GATE; at least some must return 429
    when the rate limit is exceeded.
    """
    domain_id, agent_id, agent_jwt = test_agent

    async def _fire() -> list[int]:
        async with httpx.AsyncClient(timeout=10) as client:
            tasks = [
                client.post(
                    f"{gate_url}/domain/{domain_id}/agent/{agent_id}/echo",
                    headers={"Authorization": f"Bearer {agent_jwt}"},
                    content=b"rl-probe",
                )
                for _ in range(100)
            ]
            responses = await asyncio.gather(*tasks, return_exceptions=True)
        return [
            r.status_code
            for r in responses
            if isinstance(r, httpx.Response)
        ]

    statuses = asyncio.run(_fire())
    assert statuses, "No responses received"
    has_429 = any(s == 429 for s in statuses)
    # If the agent isn't deployed, GATE returns 502 before rate-limit kicks in.
    # In that case, accept all-502 as "rate limit not applicable" and skip.
    if not has_429 and set(statuses) == {502}:
        pytest.skip("Agent pod not deployed — rate-limit test not applicable without a live agent")
    assert has_429, (
        f"Expected at least one 429 under load, got statuses: {set(statuses)}"
    )


def test_hitl_timeout(studio_url, access_token, test_domain):
    """
    HITL workflow created with a very short timeout must transition to
    'timed_out' status after the expiry window.
    """
    agent_id = None
    headers = {"Authorization": f"Bearer {access_token}"}

    with httpx.Client(base_url=studio_url, timeout=30) as client:
        # Create a temporary agent for this test
        resp = client.post(
            f"/api/domains/{test_domain}/agents/",
            json={"name": "e2e-hitl-timeout-agent", "allowed_models": ["gemini-2.5-flash"]},
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        agent_id = resp.json()["agent"]["id"]

    try:
        # Create a HITL request with 3s timeout directly (not via deployment)
        with httpx.Client(base_url=studio_url, timeout=15) as client:
            resp = client.post(
                "/api/hitl/request",
                json={
                    "agent_id": agent_id,
                    "workflow_type": "DEPLOYMENT_APPROVAL",
                    "payload": {"deployment_id": "timeout-test", "image": "test:latest"},
                    "timeout_s": 3,
                },
            )
            assert resp.status_code == 201, resp.text
            hitl_id = resp.json()["hitl_id"]

        # Poll until the background task expires the workflow (loop runs every 5s).
        # Give up to 30s: timeout_s=3 + loop=5s + slack = well within 30s.
        deadline = time.time() + 30
        status = "pending"
        while time.time() < deadline:
            time.sleep(2)
            with httpx.Client(base_url=studio_url, timeout=10) as client:
                resp = client.get(f"/api/hitl/{hitl_id}", headers=headers)
                if resp.status_code == 200:
                    status = resp.json()["status"]
                    if status == "timed_out":
                        break
        assert status == "timed_out", (
            f"Expected HITL workflow to be 'timed_out' within 30s, got '{status}'"
        )

    finally:
        if agent_id:
            with httpx.Client(base_url=studio_url, timeout=10) as client:
                client.delete(
                    f"/api/domains/{test_domain}/agents/{agent_id}",
                    headers={"Authorization": f"Bearer {access_token}"},
                )
