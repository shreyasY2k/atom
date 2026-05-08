"""
Temporal activities: one per node type.
Each activity emits audit + SSE events before and after execution.
"""

import asyncio
import base64
import os
import re
import time
from typing import Any

import httpx
from temporalio import activity

from app.worker.audit_helpers import node_start, node_complete, node_paused

TASK_QUEUE_URL = os.environ.get("TASK_QUEUE_URL", "http://task-queue:8098")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_auth_headers(auth: dict | None) -> dict:
    """Convert auth config dict to HTTP headers."""
    if not auth:
        return {}
    kind = auth.get("type")
    if kind == "bearer":
        return {"Authorization": f"Bearer {auth.get('token', '')}"}
    if kind == "basic":
        creds = base64.b64encode(
            f"{auth.get('username', '')}:{auth.get('password', '')}".encode()
        ).decode()
        return {"Authorization": f"Basic {creds}"}
    if kind == "api_key":
        header = auth.get("header", "X-API-Key")
        return {header: auth.get("key", "")}
    return {}


def _extract_fields(response: dict, extract: dict | None) -> dict:
    """Apply dot-path extraction rules to a response dict.

    extract = {"hit": "result.sanctions_hit", "score": "result.risk_score"}
    Returns {hit: True, score: 0.12} merged alongside the original response.
    """
    if not extract:
        return response
    extracted = dict(response)
    for out_key, dot_path in extract.items():
        parts = dot_path.split(".")
        val: Any = response
        for part in parts:
            if isinstance(val, dict):
                val = val.get(part)
            else:
                val = None
                break
        extracted[out_key] = val
    return extracted


def _is_acceptable_status(status: int, expect_status: list[int] | None) -> bool:
    if expect_status:
        return status in expect_status
    return 200 <= status < 300   # default: any 2xx


# ── Agent activity ─────────────────────────────────────────────────────────────

@activity.defn
async def invoke_agent_activity(payload: dict) -> dict:
    endpoint = payload["agent_endpoint"]
    run_id   = payload["run_id"]
    node_id  = payload["node_id"]
    actor_id = payload.get("actor_id", "system:unknown-agent")

    t0 = node_start(run_id, node_id, "agent", "agent", actor_id,
                    node_input=payload.get("input", {}))
    try:
        timeout = payload.get("timeout_seconds", 180)
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{endpoint}/invoke", json={"input": payload["input"]})
            r.raise_for_status()
            result = r.json()
    except Exception as e:
        result = {
            "error": str(e),
            "confidence": 0.0,
            "recommendation": "REVIEW",
            "notes_for_reviewer": f"Agent invocation failed: {e}",
            "_failed": True,
        }
    node_complete(run_id, node_id, "agent", "agent", actor_id, t0, result)
    return result


# ── HTTP activity ──────────────────────────────────────────────────────────────

@activity.defn
async def http_call_activity(payload: dict) -> dict:
    run_id  = payload["run_id"]
    node_id = payload["node_id"]
    method  = payload.get("method", "GET").upper()
    url     = payload["url"]
    body    = payload.get("body")
    timeout = payload.get("timeout_seconds", 30)
    auth_cfg    = payload.get("auth")
    extract_cfg = payload.get("extract")
    expect_status = payload.get("expect_status")
    poll_cfg    = payload.get("poll")

    # Merge node headers + auth headers
    headers = dict(payload.get("headers", {}))
    headers.update(_build_auth_headers(auth_cfg))

    t0 = node_start(run_id, node_id, "http", "system", "system:workflow-engine",
                    node_input={"method": method, "url": url, "body": body})

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if method == "GET":
                r = await client.get(url, headers=headers)
            else:
                r = await client.request(method, url, json=body, headers=headers)

        ct = r.headers.get("content-type", "")
        raw = r.json() if "application/json" in ct else {"text": r.text}
        raw["_http_status"] = r.status_code

        if not _is_acceptable_status(r.status_code, expect_status):
            raw["_soft_fail"] = True
            raw["error"] = f"unexpected HTTP status {r.status_code}"
        else:
            # Apply extraction rules
            raw = _extract_fields(raw, extract_cfg)

            # Async polling — if poll config is set, keep polling until done
            if poll_cfg:
                raw = await _poll_until_done(
                    client_factory=lambda: httpx.AsyncClient(timeout=timeout),
                    poll_url=payload.get("poll_url", url),
                    headers=headers,
                    done_condition=poll_cfg.get("done_condition", ""),
                    interval=poll_cfg.get("interval_seconds", 5),
                    max_attempts=poll_cfg.get("max_attempts", 12),
                    base_result=raw,
                    extract_cfg=extract_cfg,
                )

    except Exception as e:
        raw = {"error": str(e), "_http_status": 0, "_soft_fail": True}

    node_complete(run_id, node_id, "http", "system", "system:workflow-engine", t0, raw)
    return raw


async def _poll_until_done(
    client_factory,
    poll_url: str,
    headers: dict,
    done_condition: str,
    interval: int,
    max_attempts: int,
    base_result: dict,
    extract_cfg: dict | None,
) -> dict:
    """Keep GET-ing poll_url until done_condition is met."""
    import ast as _ast

    class _DotDict(dict):
        def __getattr__(self, k):
            v = self.get(k)
            return _DotDict(v) if isinstance(v, dict) else v

    for attempt in range(max_attempts):
        await asyncio.sleep(interval)
        try:
            async with client_factory() as client:
                r = await client.get(poll_url, headers=headers)
                ct = r.headers.get("content-type", "")
                poll_result = r.json() if "application/json" in ct else {"text": r.text}
        except Exception:
            continue

        # Evaluate done_condition against poll_result
        ctx = _DotDict({"poll_result": _DotDict(poll_result), **base_result})
        try:
            tree = _ast.parse(done_condition, mode="eval")
            done = eval(compile(tree, "<poll>", "eval"), {"__builtins__": {}},
                        {"ctx": ctx})
            if done:
                merged = {**base_result, "poll_result": poll_result,
                          "_poll_attempts": attempt + 1}
                return _extract_fields(merged, extract_cfg)
        except Exception:
            pass

    return {**base_result, "_poll_timeout": True,
            "_poll_attempts": max_attempts}


# ── Decision activity ──────────────────────────────────────────────────────────

@activity.defn
async def decision_activity(payload: dict) -> dict:
    run_id     = payload["run_id"]
    node_id    = payload["node_id"]
    expression = payload.get("expression")  # binary mode
    cases      = payload.get("cases")       # multi-way mode
    default    = payload.get("default")
    ctx_data   = payload["context"]

    t0 = node_start(run_id, node_id, "decision", "system", "system:workflow-engine",
                    node_input={"expression": expression or "",
                                "cases_count": len(cases or []),
                                "context_keys": list(ctx_data.keys())})

    import ast as _ast

    class _DotDict(dict):
        def __getattr__(self, k):
            v = self.get(k)
            return _DotDict(v) if isinstance(v, dict) else v

    def _make_ctx(d):
        if isinstance(d, dict):
            return _DotDict({k: _make_ctx(v) for k, v in d.items()})
        return d

    ctx = _make_ctx(ctx_data)
    env = {"__builtins__": {}, "ctx": ctx}

    if cases:
        # Multi-way: iterate cases, first match wins
        matched_target = default
        matched_label  = "default"
        for case in cases:
            try:
                tree = _ast.parse(case["condition"], mode="eval")
                result_val = eval(compile(tree, "<decision>", "eval"), env)
                if result_val:
                    matched_target = case["target"]
                    matched_label  = case.get("label", case["condition"])
                    break
            except Exception:
                continue

        result = {"branch": matched_label, "target": matched_target, "mode": "multi-case"}
    else:
        # Binary: expression → true/false branch
        tree = _ast.parse(expression, mode="eval")
        result_val = eval(compile(tree, "<decision>", "eval"), env)
        branch = "true" if result_val else "false"
        result = {"result": bool(result_val), "branch": branch, "mode": "binary"}

    node_complete(run_id, node_id, "decision", "system", "system:workflow-engine",
                  t0, result)
    return result


# ── Human-task activity ────────────────────────────────────────────────────────

@activity.defn
async def human_task_activity(payload: dict) -> dict:
    run_id   = payload["run_id"]
    node_id  = payload["node_id"]
    tq_url   = payload.get("task_queue_url", TASK_QUEUE_URL)

    # Extract evidence subset from context if specified
    full_ctx = payload.get("context", {})
    evidence_keys = payload.get("evidence", [])
    context_for_task = (
        {k: full_ctx[k] for k in evidence_keys if k in full_ctx}
        if evidence_keys
        else full_ctx
    )

    t0 = node_start(run_id, node_id, "human_task", "human", "system:pending-human",
                    node_input={"title": payload["title"],
                                "assignee_group": payload.get("assignee_group"),
                                "description": payload.get("description", ""),
                                "context": context_for_task})

    # Create the task in the task queue
    task_body = {
        "workflow_run_id": run_id,
        "node_id": node_id,
        "assignee_group": payload.get("assignee_group", "ops"),
        "title": payload["title"],
        "description": payload["description"],
        "actions": payload["actions"],
        "context": context_for_task,
        "priority": payload.get("priority", "medium"),
        "sla_seconds": payload.get("sla_seconds", 3600),
    }
    if payload.get("form_schema"):
        task_body["form_schema"] = payload["form_schema"]
    if payload.get("assignee_individual"):
        task_body["assignee_individual"] = payload["assignee_individual"]

    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{tq_url}/tasks", json=task_body)
        task = r.json()

    task_id = task["task_id"]
    node_paused(run_id, node_id, task_id)

    sla_seconds   = payload.get("sla_seconds", 3600)
    escalation    = payload.get("escalation_policy")
    poll_interval = 2  # seconds between polls (demo pacing)
    max_polls     = sla_seconds // poll_interval

    for _ in range(max_polls):
        await asyncio.sleep(poll_interval)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{tq_url}/tasks/{task_id}")
            t = r.json()

        if t["status"] == "RESOLVED":
            result = {
                "task_id": task_id,
                "resolution": t["resolution"],
                "resolved_by": t.get("resolved_by", "human:unknown"),
                "edits": t.get("edits"),
            }
            resolved_by = t.get("resolved_by", "human:unknown")
            node_complete(run_id, node_id, "human_task", "human", resolved_by,
                          t0, result)
            return result

    # ── SLA expired — apply escalation policy ─────────────────────────────────
    if escalation:
        action = escalation.get("action", "auto_reject")

        if action == "auto_approve":
            result = {
                "task_id": task_id,
                "resolution": "accept",
                "resolved_by": "system:sla-auto-approve",
                "sla_expired": True,
            }
            node_complete(run_id, node_id, "human_task", "system",
                          "system:workflow-engine", t0, result, "sla_auto_approve")
            return result

        elif action == "escalate":
            # Create a new task for the escalation group
            escalate_group = escalation.get("escalate_to_group", "risk-management")
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(f"{tq_url}/tasks", json={
                    **task_body,
                    "assignee_group": escalate_group,
                    "title": f"[ESCALATED] {payload['title']}",
                    "description": (f"Original SLA expired. Escalated to {escalate_group}.\n\n"
                                    + payload["description"]),
                    "sla_seconds": sla_seconds,
                    "priority": "critical",
                })
                esc_task = r.json()

            # Poll the escalated task
            for _ in range(max_polls):
                await asyncio.sleep(poll_interval)
                async with httpx.AsyncClient(timeout=10) as client:
                    r = await client.get(f"{tq_url}/tasks/{esc_task['task_id']}")
                    t = r.json()
                if t["status"] == "RESOLVED":
                    result = {
                        "task_id": esc_task["task_id"],
                        "resolution": t["resolution"],
                        "resolved_by": t.get("resolved_by", f"human:{escalate_group}"),
                        "escalated": True,
                        "original_task_id": task_id,
                    }
                    node_complete(run_id, node_id, "human_task", "human",
                                  t.get("resolved_by", f"human:{escalate_group}"),
                                  t0, result)
                    return result

    # Default: SLA expired with no escalation / escalation also timed out
    result = {
        "task_id": task_id,
        "resolution": "timeout",
        "resolved_by": "system:sla-expired",
        "sla_expired": True,
    }
    node_complete(run_id, node_id, "human_task", "system", "system:workflow-engine",
                  t0, result, "timeout")
    return result
