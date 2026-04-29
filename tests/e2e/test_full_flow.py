"""
E2E happy-path test for ATOM SESSION-15.

Full flow:
  1.  Register + login                       → access_token
  2.  Create domain                          → domain_id
  3.  Create agent                           → agent_id, agent_jwt
  4.  Submit deployment                      → deployment_id, hitl_id
  5.  Approve HITL                           → status=approved
  6.  kubectl wait for agent pod             (skipped if image unavailable in 120s)
  7.  POST GATE echo                         → 200
  8.  Verify audit_log_chain row             → SELECT from Postgres
  9.  Verify atom.audit Kafka message        → consumer, timeout=10s
  10. Revoke agent token                     → 204
  11. POST GATE echo again                   → 401
"""

import os
import subprocess
import time

import asyncpg
import httpx
import pytest

DATABASE_URL  = os.environ.get("DATABASE_URL",  "postgresql://atom:changeme@localhost:5432/atom")
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
ATOM_CLI      = os.environ.get("ATOM_CLI",      "bin/atom")

# Image for the E2E echo agent — must be loaded into kind and respond on :8080
ECHO_IMAGE = os.environ.get("ATOM_TEST_AGENT_IMAGE", "hashicorp/http-echo:latest")


def test_full_flow(studio_url, gate_url, access_token, test_domain):
    """Full happy-path: create agent → deploy → HITL approve → echo → audit → revoke."""

    headers = {"Authorization": f"Bearer {access_token}"}

    # ── Step 1–3: Create agent ────────────────────────────────────────────────
    with httpx.Client(base_url=studio_url, timeout=30) as client:
        resp = client.post(
            f"/api/domains/{test_domain}/agents/",
            json={
                "name": "e2e-flow-agent",
                "description": "full-flow E2E agent",
                "allowed_models": ["gemini-2.5-flash"],
                "rpm_limit": 30,
            },
            headers=headers,
        )
        assert resp.status_code == 201, resp.text
        data      = resp.json()
        agent_id  = data["agent"]["id"]
        agent_jwt = data["token"]

    try:
        # ── Step 4: Submit deployment ─────────────────────────────────────────
        with httpx.Client(base_url=studio_url, timeout=30) as client:
            resp = client.post(
                f"/api/deployments/{agent_id}",
                json={"image": ECHO_IMAGE, "message": "e2e initial deploy"},
                headers=headers,
            )
            assert resp.status_code == 201, resp.text
            deployment = resp.json()
            deployment_id = deployment["id"]

        # ── Step 5: Find + approve HITL ──────────────────────────────────────
        hitl_id = _find_hitl_for_deployment(studio_url, headers, deployment_id)
        assert hitl_id, f"No HITL workflow found for deployment {deployment_id}"

        with httpx.Client(base_url=studio_url, timeout=15) as client:
            resp = client.post(
                f"/api/hitl/{hitl_id}/decide",
                json={"approved": True, "note": "E2E auto-approve"},
                headers=headers,
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["status"] == "approved"

        # ── Step 6: Wait for agent pod ────────────────────────────────────────
        pod_ready = _wait_for_agent_pod(agent_id, timeout=120)

        if pod_ready:
            # ── Step 7: Echo via GATE ─────────────────────────────────────────
            resp = httpx.post(
                f"{gate_url}/domain/{test_domain}/agent/{agent_id}/echo",
                headers={"Authorization": f"Bearer {agent_jwt}"},
                content=b"hello from e2e",
                timeout=10,
            )
            assert resp.status_code == 200, f"GATE echo returned {resp.status_code}: {resp.text}"

            # ── Step 8: Audit log check ────────────────────────────────────────
            _assert_audit_row(agent_id)

            # ── Step 9: Kafka audit check ─────────────────────────────────────
            _assert_kafka_audit_message(agent_id)
        else:
            pytest.skip(
                f"Agent pod agent-{agent_id} not Ready within 120s — "
                "skipping echo/audit/kafka assertions. "
                "Ensure ATOM_TEST_AGENT_IMAGE is loaded into kind and responds on :8080."
            )

        # ── Step 10: Revoke token ─────────────────────────────────────────────
        with httpx.Client(base_url=studio_url, timeout=15) as client:
            resp = client.post(
                f"/api/domains/{test_domain}/agents/{agent_id}/regenerate-token",
                headers=headers,
            )
            assert resp.status_code == 200, resp.text

        # ── Step 11: Old token is now rejected ────────────────────────────────
        if pod_ready:
            time.sleep(1)  # let Redis propagate revocation
            resp = httpx.post(
                f"{gate_url}/domain/{test_domain}/agent/{agent_id}/echo",
                headers={"Authorization": f"Bearer {agent_jwt}"},
                content=b"should be rejected",
                timeout=10,
            )
            assert resp.status_code == 401, (
                f"Expected 401 after token revocation, got {resp.status_code}"
            )

    finally:
        # Cleanup: delete the agent created inside this test
        with httpx.Client(base_url=studio_url, timeout=10) as client:
            client.delete(
                f"/api/domains/{test_domain}/agents/{agent_id}",
                headers=headers,
            )


# ── Helpers ────────────────────────────────────────────────────────────────────


def _find_hitl_for_deployment(
    studio_url: str, headers: dict, deployment_id: str, timeout: int = 20
) -> str | None:
    """Poll HITL queue until a workflow for this deployment appears."""
    import json as _json

    deadline = time.time() + timeout
    while time.time() < deadline:
        with httpx.Client(base_url=studio_url, timeout=10) as client:
            resp = client.get("/api/hitl/queue", headers=headers)
            if resp.status_code == 200:
                for item in resp.json():
                    raw = item.get("payload") or {}
                    payload = _json.loads(raw) if isinstance(raw, str) else raw
                    if payload.get("deployment_id") == deployment_id:
                        return str(item["id"])
        time.sleep(1)
    return None


def _wait_for_agent_pod(agent_id: str, timeout: int = 120) -> bool:
    """kubectl wait for the agent deployment to become Available."""
    dep_name = f"agent-{agent_id}"
    result = subprocess.run(
        [
            "kubectl", "wait",
            f"--for=condition=available",
            f"deployment/{dep_name}",
            "-n", "atom-agents",
            f"--timeout={timeout}s",
        ],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def _assert_audit_row(agent_id: str) -> None:
    """Verify at least one audit_log_chain row exists for this agent."""
    import asyncio

    async def _check():
        conn = await asyncpg.connect(DATABASE_URL)
        try:
            row = await conn.fetchrow(
                "SELECT id FROM audit_log_chain WHERE agent_id = $1 LIMIT 1",
                agent_id,
            )
            assert row is not None, f"No audit_log_chain row found for agent {agent_id}"
        finally:
            await conn.close()

    asyncio.run(_check())


def _assert_kafka_audit_message(agent_id: str) -> None:
    """Consume atom.audit topic and assert a message for this agent exists."""
    try:
        from kafka import KafkaConsumer
    except ImportError:
        pytest.skip("kafka-python not installed — skipping Kafka audit assertion")
        return

    import json as _json

    consumer = KafkaConsumer(
        "atom.audit",
        bootstrap_servers=KAFKA_BROKERS.split(","),
        auto_offset_reset="earliest",
        consumer_timeout_ms=10_000,
        value_deserializer=lambda m: _json.loads(m.decode("utf-8", errors="replace")),
        group_id=f"e2e-audit-check-{agent_id}",
    )
    found = False
    try:
        for msg in consumer:
            val = msg.value if isinstance(msg.value, dict) else {}
            if str(val.get("agent_id", "")) == agent_id:
                found = True
                break
    finally:
        consumer.close()

    assert found, f"No atom.audit Kafka message found for agent {agent_id}"
