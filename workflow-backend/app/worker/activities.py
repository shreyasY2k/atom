"""
Temporal activities: one per node type.
Each activity emits audit + SSE events before and after execution.
HTTP activities fail-soft on connection errors (option C).
"""

import asyncio
import os
import re
import time

import httpx
from temporalio import activity

from app.worker.audit_helpers import node_start, node_complete, node_paused

TASK_QUEUE_URL = os.environ.get("TASK_QUEUE_URL", "http://task-queue:8098")


# ---------------------------------------------------------------------------
# Agent activity
# ---------------------------------------------------------------------------

@activity.defn
async def invoke_agent_activity(payload: dict) -> dict:
    endpoint = payload["agent_endpoint"]
    run_id   = payload["run_id"]
    node_id  = payload["node_id"]
    actor_id = payload.get("actor_id", "system:unknown-agent")

    t0 = node_start(run_id, node_id, "agent", "agent", actor_id)
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            r = await client.post(f"{endpoint}/invoke", json={"input": payload["input"]})
            r.raise_for_status()
            result = r.json()
    except Exception as e:
        result = {"error": str(e), "confidence": 0.0, "recommendation": "REVIEW",
                  "notes_for_reviewer": f"Agent invocation failed: {e}"}
    node_complete(run_id, node_id, "agent", "agent", actor_id, t0, result)
    return result


# ---------------------------------------------------------------------------
# HTTP activity (fail-soft)
# ---------------------------------------------------------------------------

@activity.defn
async def http_call_activity(payload: dict) -> dict:
    run_id  = payload["run_id"]
    node_id = payload["node_id"]
    method  = payload.get("method", "GET").upper()
    url     = payload["url"]
    body    = payload.get("body")
    headers = payload.get("headers", {})
    timeout = payload.get("timeout_seconds", 30)

    t0 = node_start(run_id, node_id, "http", "system", "system:workflow-engine")
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if method == "GET":
                r = await client.get(url, headers=headers)
            else:
                r = await client.request(method, url, json=body, headers=headers)
        ct = r.headers.get("content-type", "")
        result = r.json() if "application/json" in ct else {"text": r.text}
        result["_http_status"] = r.status_code
    except Exception as e:
        # Fail-soft: record error, let workflow continue
        result = {"error": str(e), "_http_status": 0, "_soft_fail": True}

    node_complete(run_id, node_id, "http", "system", "system:workflow-engine", t0, result)
    return result


# ---------------------------------------------------------------------------
# Decision activity
# ---------------------------------------------------------------------------

@activity.defn
async def decision_activity(payload: dict) -> dict:
    run_id     = payload["run_id"]
    node_id    = payload["node_id"]
    expression = payload["expression"]
    ctx        = payload["context"]

    t0 = node_start(run_id, node_id, "decision", "system", "system:workflow-engine")

    import ast as _ast

    class _DotDict(dict):
        def __getattr__(self, k):
            v = self.get(k)
            return _DotDict(v) if isinstance(v, dict) else v

    def _make_ctx(d):
        if isinstance(d, dict):
            return _DotDict({k: _make_ctx(v) for k, v in d.items()})
        return d

    tree = _ast.parse(expression, mode="eval")
    result_val = eval(compile(tree, "<decision>", "eval"),
                      {"__builtins__": {}},
                      {"ctx": _make_ctx(ctx)})
    branch = "true" if result_val else "false"
    result = {"result": bool(result_val), "branch": branch}

    node_complete(run_id, node_id, "decision", "system", "system:workflow-engine", t0, result)
    return result


# ---------------------------------------------------------------------------
# Human-task activity
# ---------------------------------------------------------------------------

@activity.defn
async def human_task_activity(payload: dict) -> dict:
    run_id   = payload["run_id"]
    node_id  = payload["node_id"]
    tq_url   = payload.get("task_queue_url", TASK_QUEUE_URL)

    t0 = node_start(run_id, node_id, "human_task", "human", "system:pending-human")

    # Create the task
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{tq_url}/tasks", json={
            "workflow_run_id": run_id,
            "node_id": node_id,
            "assignee_group": payload["assignee_group"],
            "title": payload["title"],
            "description": payload["description"],
            "actions": payload["actions"],
            "context": payload.get("context", {}),
        })
        task = r.json()

    task_id = task["task_id"]
    node_paused(run_id, node_id, task_id)

    # Poll until resolved (demo: 2-second intervals, up to SLA)
    max_polls = payload.get("sla_seconds", 3600) // 2
    for _ in range(max_polls):
        await asyncio.sleep(2)
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
            # Re-emit node_complete with real human actor
            resolved_by = t.get("resolved_by", "human:unknown")
            node_complete(run_id, node_id, "human_task", "human", resolved_by,
                          t0, result)
            return result

    # SLA expired
    result = {"task_id": task_id, "resolution": "timeout",
              "resolved_by": "system:sla-expired"}
    node_complete(run_id, node_id, "human_task", "system", "system:workflow-engine",
                  t0, result, "timeout")
    return result
