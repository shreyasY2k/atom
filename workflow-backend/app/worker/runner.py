"""
MphasisWorkflowRunner — generic Temporal workflow that interprets a
workflow-spec dict as a node graph and executes it activity by activity.

Ported from temporal/worker.py stub with:
  - confidence-threshold routing
  - SSE event publishing per node
  - audit events via activities
  - fail-soft http (option C: connection errors stored, workflow continues)
"""

import re
from datetime import timedelta
from typing import Any

from temporalio import workflow

from app.worker.activities import (
    decision_activity,
    http_call_activity,
    human_task_activity,
    invoke_agent_activity,
)
from app.core.event_bus import publish


def _walk_path(path: list[str], ctx: dict) -> Any:
    """Walk a dotted path like ['ctx', 'input', 'customer_id'] against ctx."""
    v: Any = ctx
    for p in path[1:]:  # skip 'ctx'
        if isinstance(v, dict):
            v = v.get(p)
        else:
            return None
    return v


def _resolve(template: Any, ctx: dict) -> Any:
    """
    Resolve a value against ctx.  Two syntaxes supported:
      {{ ctx.foo.bar }}   — Jinja-style template interpolation
      ctx.foo.bar         — bare expression (used in input_mapping values)
    Non-strings are returned unchanged.
    """
    if not isinstance(template, str):
        return template

    stripped = template.strip()

    # Bare ctx expression: "ctx.input.customer_id"
    if re.match(r"^ctx(\.[a-zA-Z_][a-zA-Z0-9_]*)+$", stripped):
        parts = stripped.split(".")
        result = _walk_path(parts, ctx)
        return result if result is not None else template

    # {{ ctx.foo.bar }} template syntax
    def repl(m):
        path = m.group(1).strip().split(".")
        if path[0] != "ctx":
            return m.group(0)
        v = _walk_path(path, ctx)
        return str(v) if v is not None else ""

    return re.sub(r"\{\{\s*([^}]+)\s*\}\}", repl, template)


def _resolve_dict(d: dict | None, ctx: dict) -> dict:
    if not d:
        return {}
    return {k: _resolve(v, ctx) for k, v in d.items()}


@workflow.defn(sandboxed=False)
class MphasisWorkflowRunner:
    """Interprets a workflow-spec dict as a sequential node graph."""

    @workflow.run
    async def run(self, args: dict) -> dict:
        spec          = args["spec"]
        input_data    = args["input"]
        agent_eps     = args.get("agent_endpoints", {})
        task_queue_url = args.get("task_queue_url", "http://task-queue:8098")
        run_id        = args.get("run_id", "unknown")

        ctx: dict = {"input": input_data}
        nodes = spec["spec"]["nodes"]
        nodes_by_id = {n["id"]: n for n in nodes}

        # Emit workflow start
        publish(run_id, {"event": "workflow_started", "run_id": run_id})

        current_id: str | None = nodes[0]["id"]

        while current_id is not None:
            node = nodes_by_id.get(current_id)
            if node is None:
                break

            ntype = node["type"]

            # ----------------------------------------------------------------
            # agent node
            # ----------------------------------------------------------------
            if ntype == "agent":
                agent_name = node["agent_ref"]["name"]
                endpoint   = agent_eps.get(agent_name, "")
                actor_id   = args.get("agent_actor_ids", {}).get(agent_name,
                                                                   "system:unknown-agent")
                node_input = _resolve_dict(node.get("input_mapping"), ctx)

                result = await workflow.execute_activity(
                    invoke_agent_activity,
                    {
                        "agent_endpoint": endpoint,
                        "input": node_input,
                        "run_id": run_id,
                        "node_id": node["id"],
                        "actor_id": actor_id,
                    },
                    start_to_close_timeout=timedelta(seconds=300),
                )

                if node.get("output_capture"):
                    ctx[node["output_capture"]] = result

                # Confidence threshold routing
                threshold = node.get("confidence_threshold")
                if threshold is not None:
                    confidence = float(result.get("confidence", 1.0))
                    if confidence < threshold:
                        fallback = node.get("fallback_node")
                        publish(run_id, {
                            "event": "node_routed",
                            "run_id": run_id,
                            "from": node["id"],
                            "to": fallback,
                            "reason": f"confidence {confidence:.2f} < threshold {threshold}",
                        })
                        current_id = fallback
                        continue

                publish(run_id, {
                    "event": "node_routed",
                    "run_id": run_id,
                    "from": node["id"],
                    "to": node.get("next"),
                    "reason": f"confidence {result.get('confidence', 'n/a')} >= threshold",
                })
                current_id = node.get("next")

            # ----------------------------------------------------------------
            # http node
            # ----------------------------------------------------------------
            elif ntype == "http":
                url = _resolve(node.get("url_template", ""), ctx)
                body = _resolve_dict(node.get("body_template"), ctx) or None

                result = await workflow.execute_activity(
                    http_call_activity,
                    {
                        "run_id": run_id,
                        "node_id": node["id"],
                        "method": node.get("method", "GET"),
                        "url": url,
                        "body": body,
                        "headers": node.get("headers", {}),
                        "timeout_seconds": node.get("timeout_seconds", 30),
                    },
                    start_to_close_timeout=timedelta(seconds=node.get("timeout_seconds", 30) + 5),
                )

                if node.get("output_capture"):
                    ctx[node["output_capture"]] = result
                current_id = node.get("next")

            # ----------------------------------------------------------------
            # decision node
            # ----------------------------------------------------------------
            elif ntype == "decision":
                result = await workflow.execute_activity(
                    decision_activity,
                    {
                        "run_id": run_id,
                        "node_id": node["id"],
                        "expression": node["expression"],
                        "context": ctx,
                    },
                    start_to_close_timeout=timedelta(seconds=10),
                )

                branch = result["branch"]
                next_node = node.get("branches", {}).get(branch)
                publish(run_id, {
                    "event": "node_routed",
                    "run_id": run_id,
                    "from": node["id"],
                    "to": next_node,
                    "reason": f"expression '{node['expression']}' = {result['result']}",
                })
                current_id = next_node

            # ----------------------------------------------------------------
            # human_task node
            # ----------------------------------------------------------------
            elif ntype == "human_task":
                tt = node.get("task_template", {})
                result = await workflow.execute_activity(
                    human_task_activity,
                    {
                        "run_id": run_id,
                        "node_id": node["id"],
                        "task_queue_url": task_queue_url,
                        "assignee_group": node.get("assignee_group", "ops"),
                        "title": _resolve(tt.get("title", "Task"), ctx),
                        "description": _resolve(tt.get("description", ""), ctx),
                        "actions": tt.get("actions", ["accept", "reject"]),
                        "sla_seconds": node.get("sla_seconds", 3600),
                        "context": ctx,
                    },
                    start_to_close_timeout=timedelta(seconds=node.get("sla_seconds", 3600) + 60),
                )

                if node.get("output_capture"):
                    ctx[node["output_capture"]] = result
                current_id = node.get("next")

            else:
                break

        publish(run_id, {"event": "workflow_completed", "run_id": run_id,
                         "final_ctx_keys": list(ctx.keys())})
        return {"final_context": ctx, "run_id": run_id}
