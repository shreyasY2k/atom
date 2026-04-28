# -*- coding: utf-8 -*-
"""
hiclaw_hooks.py

Allows agents to pause and request a human decision via the atom-studio
HITL queue. The calling agent blocks (polling) until approved/rejected
or the timeout expires.

Usage:
    from agentscope.hitl import request_human_decision

    decision = request_human_decision(
        payload={"action": "approve_loan", "amount": 50000, "customer": "4821"},
        timeout_s=300,
    )
    if decision["approved"]:
        proceed_with_loan()
    else:
        reject_with_reason(decision["note"])
"""

import os
import time
from typing import Any

import httpx


def request_human_decision(
    payload: dict[str, Any],
    timeout_s: int = 300,
    poll_interval_s: int = 5,
) -> dict[str, Any]:
    """Submit a HITL decision request to atom-studio and block until resolved.

    Args:
        payload:
            Arbitrary dict describing the decision needed. Shown to the
            human reviewer in the studio HITL queue.
        timeout_s:
            Seconds to wait before raising TimeoutError. The agent's
            ``hitl_fallback`` setting (ABORT | CONTINUE | ESCALATE)
            determines the downstream behaviour after timeout.
        poll_interval_s:
            How often to poll for a decision. Defaults to 5 s.

    Returns:
        ``{"approved": bool, "note": str, "decided_by": str, "decided_at": str}``

    Raises:
        TimeoutError: If no decision is made within ``timeout_s``.
        EnvironmentError: If ATOM env vars are not set.
        httpx.HTTPStatusError: If the server returns a non-2xx response.
    """
    gate_url = os.environ["ATOM_GATE_URL"].rstrip("/")
    domain_id = os.environ["ATOM_DOMAIN_ID"]
    agent_id = os.environ["ATOM_AGENT_ID"]
    jwt = os.environ["ATOM_AGENT_JWT"]

    hitl_submit_url = f"{gate_url}/domain/{domain_id}/agent/{agent_id}/hitl/request"
    status_url_tpl = (
        f"{gate_url}/domain/{domain_id}/agent/{agent_id}/hitl/{{hitl_id}}/status"
    )
    headers = {
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    }

    # Submit the HITL request.
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            hitl_submit_url,
            json={"payload": payload, "timeout_s": timeout_s},
            headers=headers,
        )
        resp.raise_for_status()
        hitl_id: str = resp.json()["hitl_id"]

    # Poll until decided or timeout.
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        time.sleep(poll_interval_s)
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                status_url_tpl.format(hitl_id=hitl_id),
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        status = data.get("status", "pending")
        if status in ("approved", "rejected"):
            return {
                "approved": status == "approved",
                "note": data.get("decision_note", ""),
                "decided_by": data.get("decided_by", ""),
                "decided_at": data.get("decided_at", ""),
            }

    raise TimeoutError(
        f"HITL decision timed out after {timeout_s}s "
        f"(hitl_id={hitl_id}). "
        "Check the agent's hitl_fallback setting for the configured response.",
    )
