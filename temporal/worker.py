"""
Atom Workflow Worker — Temporal worker that executes workflow-spec.yaml.

This is a stub showing the intended shape. Task 03b (workflow-backend)
fills in the actual logic.

The pattern: one generic Temporal workflow class (`AtomWorkflowRunner`)
takes a workflow-spec dict + input payload, walks the node graph,
executes activities per node type. This means we don't have to compile
each workflow into custom Temporal code — we interpret the spec.

Activities:
  invoke_agent_activity     — call deployed agent's /invoke endpoint
  http_call_activity        — generic HTTP call
  decision_activity         — evaluate Python expression against context
  human_task_activity       — post to task queue, signal-wait, return resolution

Audit:
  Every activity emits a structured event to MinIO via the audit_logger
  helper. Workflow start/end events too.
"""
import asyncio
import os
from datetime import timedelta
from typing import Any

from temporalio import activity, workflow
from temporalio.client import Client
from temporalio.worker import Worker

# ============================================================
# ACTIVITIES
# ============================================================

@activity.defn
async def invoke_agent_activity(payload: dict) -> dict:
    """Invoke a deployed agent. payload includes agent endpoint, input, run_id."""
    import httpx
    endpoint = payload["agent_endpoint"]
    agent_input = payload["input"]
    run_id = payload["run_id"]
    node_id = payload["node_id"]

    # TODO: emit audit event before
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{endpoint}/invoke", json={"input": agent_input})
        r.raise_for_status()
        result = r.json()
    # TODO: emit audit event after, recording agent's service-account ID
    return result


@activity.defn
async def http_call_activity(payload: dict) -> dict:
    """Generic HTTP call for `http` workflow nodes."""
    import httpx
    method = payload.get("method", "GET").upper()
    url = payload["url"]
    body = payload.get("body")
    headers = payload.get("headers", {})

    async with httpx.AsyncClient(timeout=30) as client:
        if method == "GET":
            r = await client.get(url, headers=headers)
        else:
            r = await client.request(method, url, json=body, headers=headers)
        return {"status": r.status_code, "body": r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text}


@activity.defn
async def decision_activity(payload: dict) -> dict:
    """Evaluate a safe Python expression against context."""
    import ast
    expression = payload["expression"]
    ctx = payload["context"]

    # Parse + walk the AST to ensure only safe constructs
    tree = ast.parse(expression, mode="eval")
    _ensure_safe(tree)

    # Build the eval namespace: only ctx is exposed
    result = eval(compile(tree, "<decision>", "eval"), {"__builtins__": {}}, {"ctx": _DotDict(ctx)})
    return {"result": bool(result), "branch": "true" if result else "false"}


def _ensure_safe(tree):
    """Disallow function calls, attribute access beyond ctx, etc."""
    import ast
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            raise ValueError("function calls not allowed in decision expressions")
        if isinstance(node, ast.Import) or isinstance(node, ast.ImportFrom):
            raise ValueError("imports not allowed")
        if isinstance(node, ast.Lambda):
            raise ValueError("lambdas not allowed")


class _DotDict(dict):
    """Minimal dict.attr access for ctx.input.amount_usd-style expressions."""
    def __getattr__(self, key):
        v = self.get(key)
        if isinstance(v, dict):
            return _DotDict(v)
        return v


@activity.defn
async def human_task_activity(payload: dict) -> dict:
    """Post a task to the queue, wait for resolution via signal."""
    import httpx
    task_queue_url = payload["task_queue_url"]

    # 1) Create the task
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{task_queue_url}/tasks", json={
            "workflow_run_id": payload["run_id"],
            "node_id": payload["node_id"],
            "assignee_group": payload["assignee_group"],
            "title": payload["title"],
            "description": payload["description"],
            "actions": payload["actions"],
            "context": payload["context"],
        })
        task = r.json()

    # 2) Poll for resolution. (In production: use Temporal signals instead.)
    task_id = task["task_id"]
    while True:
        await asyncio.sleep(2)
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{task_queue_url}/tasks/{task_id}")
            t = r.json()
            if t["status"] == "RESOLVED":
                return {
                    "task_id": task_id,
                    "resolution": t["resolution"],
                    "resolved_by": t["resolved_by"],
                    "edits": t.get("edits"),
                }


# ============================================================
# WORKFLOW
# ============================================================

@workflow.defn(sandboxed=False)
class AtomWorkflowRunner:
    """Generic runner that interprets a workflow-spec dict as a node graph."""

    @workflow.run
    async def run(self, args: dict) -> dict:
        spec = args["spec"]
        input_data = args["input"]
        ctx = {"input": input_data}

        # Walk nodes starting from the first one
        nodes_by_id = {n["id"]: n for n in spec["spec"]["nodes"]}
        current_id = spec["spec"]["nodes"][0]["id"]

        while current_id is not None:
            node = nodes_by_id[current_id]
            ntype = node["type"]

            if ntype == "agent":
                # Resolve agent endpoint from registry (lookup happens upstream
                # in workflow-backend; passed in via args)
                agent_endpoint = args["agent_endpoints"].get(node["agent_ref"]["name"])
                node_input = {
                    k: _resolve_template(v, ctx)
                    for k, v in node.get("input_mapping", {}).items()
                }
                result = await workflow.execute_activity(
                    invoke_agent_activity,
                    {
                        "agent_endpoint": agent_endpoint,
                        "input": node_input,
                        "run_id": workflow.info().workflow_id,
                        "node_id": node["id"],
                    },
                    start_to_close_timeout=timedelta(seconds=180),
                )
                # Capture output
                if "output_capture" in node:
                    ctx[node["output_capture"]] = result

                # Confidence threshold routing
                threshold = node.get("confidence_threshold")
                if threshold is not None:
                    confidence = float(result.get("confidence", 1.0))
                    if confidence < threshold:
                        current_id = node.get("fallback_node")
                        continue

                current_id = node.get("next")

            elif ntype == "http":
                result = await workflow.execute_activity(
                    http_call_activity,
                    {
                        "method": node.get("method", "GET"),
                        "url": _resolve_template(node["url_template"], ctx),
                        "body": {k: _resolve_template(v, ctx) for k, v in node.get("body_template", {}).items()} if node.get("body_template") else None,
                        "headers": node.get("headers", {}),
                    },
                    start_to_close_timeout=timedelta(seconds=node.get("timeout_seconds", 30)),
                )
                if "output_capture" in node:
                    ctx[node["output_capture"]] = result
                current_id = node.get("next")

            elif ntype == "decision":
                result = await workflow.execute_activity(
                    decision_activity,
                    {"expression": node["expression"], "context": ctx},
                    start_to_close_timeout=timedelta(seconds=5),
                )
                current_id = node["branches"][result["branch"]]

            elif ntype == "human_task":
                result = await workflow.execute_activity(
                    human_task_activity,
                    {
                        "task_queue_url": args["task_queue_url"],
                        "run_id": workflow.info().workflow_id,
                        "node_id": node["id"],
                        "assignee_group": node["assignee_group"],
                        "title": _resolve_template(node["task_template"]["title"], ctx),
                        "description": _resolve_template(node["task_template"]["description"], ctx),
                        "actions": node["task_template"]["actions"],
                        "context": ctx,
                    },
                    start_to_close_timeout=timedelta(seconds=node.get("sla_seconds", 86400)),
                )
                if "output_capture" in node:
                    ctx[node["output_capture"]] = result
                current_id = node.get("next")

            else:
                raise ValueError(f"unknown node type: {ntype}")

        return {"final_context": ctx}


def _resolve_template(template_str, ctx):
    """Cheap interpolation. Supports {{ ctx.foo.bar }} only."""
    import re
    if not isinstance(template_str, str):
        return template_str

    def repl(m):
        path = m.group(1).strip()
        # path looks like 'ctx.input.customer_id'
        parts = path.split(".")
        if parts[0] != "ctx":
            return m.group(0)
        v = ctx
        for p in parts[1:]:
            if isinstance(v, dict):
                v = v.get(p)
            else:
                v = getattr(v, p, None)
        return str(v) if v is not None else ""

    return re.sub(r"\{\{\s*([^}]+)\s*\}\}", repl, template_str)


# ============================================================
# WORKER ENTRYPOINT
# ============================================================

async def main():
    client = await Client.connect(os.environ.get("TEMPORAL_HOST", "localhost:7233"))
    worker = Worker(
        client,
        task_queue=os.environ.get("TEMPORAL_TASK_QUEUE", "ats-task-queue"),
        workflows=[AtomWorkflowRunner],
        activities=[
            invoke_agent_activity,
            http_call_activity,
            decision_activity,
            human_task_activity,
        ],
    )
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
