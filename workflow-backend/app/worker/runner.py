"""
AtomWorkflowRunner — generic Temporal workflow that interprets a
workflow-spec dict as a node graph and executes it activity by activity.

Supports:
  - Four node types: agent, http, decision, human_task
  - Retry via Temporal RetryPolicy
  - on_error routing (node-level and workflow-level fallback)
  - skip_if for human_task (auto-resolution without creating a task)
  - Multi-way decision (cases list) + binary (expression + branches)
  - HTTP auth, extract, expect_status, async polling
  - Human-task escalation_policy on SLA expiry
"""

import ast as _ast
import re
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy

from app.worker.activities import (
    decision_activity,
    http_call_activity,
    human_task_activity,
    invoke_agent_activity,
)
from app.core.event_bus import publish


# ── Context helpers ───────────────────────────────────────────────────────────

def _walk_path(path: list[str], ctx: dict) -> Any:
    v: Any = ctx
    for p in path[1:]:   # skip 'ctx'
        if isinstance(v, dict):
            v = v.get(p)
        else:
            return None
    return v


def _resolve(template: Any, ctx: dict) -> Any:
    """
    Resolve a template against ctx.  Two syntaxes:
      {{ ctx.foo.bar }}  — Jinja-style
      ctx.foo.bar        — bare expression
    """
    if not isinstance(template, str):
        return template

    stripped = template.strip()

    if re.match(r"^ctx(\.[a-zA-Z_][a-zA-Z0-9_]*)+$", stripped):
        parts = stripped.split(".")
        result = _walk_path(parts, ctx)
        return result if result is not None else template

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


# ── Retry policy builder ──────────────────────────────────────────────────────

def _make_retry_policy(retry: dict | None, max_attempts_default: int = 1) -> RetryPolicy:
    if not retry:
        return RetryPolicy(maximum_attempts=max_attempts_default)
    backoff = retry.get("backoff", "exponential")
    return RetryPolicy(
        maximum_attempts=retry.get("max_attempts", 3),
        initial_interval=timedelta(seconds=retry.get("initial_delay_seconds", 1.0)),
        maximum_interval=timedelta(seconds=retry.get("max_delay_seconds", 60.0)),
        backoff_coefficient=2.0 if backoff == "exponential" else 1.0,
    )


# ── Expression evaluator (safe subset) ───────────────────────────────────────

class _DotDict(dict):
    def __getattr__(self, k):
        v = self.get(k)
        return _DotDict(v) if isinstance(v, dict) else v


def _eval_condition(expr: str, ctx: dict) -> bool:
    def _make(d):
        if isinstance(d, dict):
            return _DotDict({k: _make(v) for k, v in d.items()})
        return d

    tree = _ast.parse(expr, mode="eval")
    return bool(eval(compile(tree, "<condition>", "eval"),
                     {"__builtins__": {}},
                     {"ctx": _make(ctx)}))


# ── Workflow ──────────────────────────────────────────────────────────────────

@workflow.defn(sandboxed=False)
class AtomWorkflowRunner:
    """Generic interpreter for workflow-spec node graphs."""

    @workflow.run
    async def run(self, args: dict) -> dict:
        spec           = args["spec"]
        input_data     = args["input"]
        agent_eps      = args.get("agent_endpoints", {})
        agent_actor_ids = args.get("agent_actor_ids", {})
        task_queue_url = args.get("task_queue_url", "http://task-queue:8098")
        run_id         = args.get("run_id", "unknown")

        ctx: dict = {"input": input_data}
        spec_inner = spec["spec"]
        nodes = spec_inner["nodes"]
        nodes_by_id = {n["id"]: n for n in nodes}

        # Workflow-level defaults
        global_error_handler = spec_inner.get("error_handler")

        publish(run_id, {"event": "workflow_started", "run_id": run_id})

        current_id: str | None = nodes[0]["id"]

        while current_id is not None:
            node = nodes_by_id.get(current_id)
            if node is None:
                break

            ntype = node["type"]

            try:
                result, next_id = await self._execute_node(
                    node, ntype, ctx, agent_eps, agent_actor_ids,
                    task_queue_url, run_id, nodes_by_id,
                )
                if node.get("output_capture") and result is not None:
                    ctx[node["output_capture"]] = result
                current_id = next_id

            except Exception as exc:
                # on_error routing (node-level first, then workflow-level)
                error_target = node.get("on_error") or global_error_handler
                publish(run_id, {
                    "event": "node_error",
                    "run_id": run_id,
                    "node_id": node["id"],
                    "error": str(exc),
                    "routed_to": error_target,
                })
                if error_target:
                    ctx["_last_error"] = {"node_id": node["id"], "error": str(exc)}
                    current_id = error_target
                else:
                    publish(run_id, {"event": "workflow_failed", "run_id": run_id,
                                     "reason": str(exc)})
                    return {"final_context": ctx, "run_id": run_id,
                            "status": "failed", "error": str(exc)}

        publish(run_id, {"event": "workflow_completed", "run_id": run_id,
                         "final_ctx_keys": list(ctx.keys())})
        return {"final_context": ctx, "run_id": run_id, "status": "completed"}

    # ── Node dispatcher ───────────────────────────────────────────────────────

    async def _execute_node(
        self,
        node: dict,
        ntype: str,
        ctx: dict,
        agent_eps: dict,
        agent_actor_ids: dict,
        task_queue_url: str,
        run_id: str,
        nodes_by_id: dict,
    ) -> tuple[Any, str | None]:
        """Execute one node and return (result, next_node_id)."""

        if ntype == "agent":
            return await self._run_agent(node, ctx, agent_eps, agent_actor_ids, run_id)

        elif ntype == "http":
            return await self._run_http(node, ctx, run_id)

        elif ntype == "decision":
            return await self._run_decision(node, ctx, run_id)

        elif ntype == "human_task":
            return await self._run_human_task(node, ctx, task_queue_url, run_id)

        # Unknown type — skip (forward compatible)
        return None, node.get("next")

    # ── Agent ─────────────────────────────────────────────────────────────────

    async def _run_agent(
        self, node: dict, ctx: dict, agent_eps: dict, agent_actor_ids: dict, run_id: str
    ) -> tuple[dict, str | None]:
        agent_name = node["agent_ref"]["name"]
        endpoint   = agent_eps.get(agent_name, "")
        actor_id   = agent_actor_ids.get(agent_name, "system:unknown-agent")
        node_input = _resolve_dict(node.get("input_mapping"), ctx)
        timeout    = node.get("timeout_seconds", 300)

        result = await workflow.execute_activity(
            invoke_agent_activity,
            {
                "agent_endpoint": endpoint,
                "input": node_input,
                "run_id": run_id,
                "node_id": node["id"],
                "actor_id": actor_id,
                "timeout_seconds": timeout,
            },
            start_to_close_timeout=timedelta(seconds=timeout + 5),
            retry_policy=_make_retry_policy(node.get("retry")),
        )

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
                return result, fallback

        publish(run_id, {
            "event": "node_routed",
            "run_id": run_id,
            "from": node["id"],
            "to": node.get("next"),
            "reason": f"confidence {result.get('confidence', 'n/a')} >= threshold",
        })
        return result, node.get("next")

    # ── HTTP ──────────────────────────────────────────────────────────────────

    async def _run_http(
        self, node: dict, ctx: dict, run_id: str
    ) -> tuple[dict, str | None]:
        url  = _resolve(node.get("url_template", ""), ctx)
        body = _resolve_dict(node.get("body_template"), ctx) or None
        timeout = node.get("timeout_seconds", 30)

        # Resolve auth token/key templates
        auth = node.get("auth")
        if auth:
            auth = {k: (_resolve(v, ctx) if isinstance(v, str) else v)
                    for k, v in auth.items()}

        result = await workflow.execute_activity(
            http_call_activity,
            {
                "run_id": run_id,
                "node_id": node["id"],
                "method": node.get("method", "GET"),
                "url": url,
                "body": body,
                "headers": _resolve_dict(node.get("headers"), ctx),
                "timeout_seconds": timeout,
                "auth": auth,
                "extract": node.get("extract"),
                "expect_status": node.get("expect_status"),
                "poll": node.get("poll"),
                "poll_url": _resolve(
                    node.get("poll", {}).get("poll_url_template", url), ctx
                ) if node.get("poll") else None,
            },
            start_to_close_timeout=timedelta(seconds=timeout + 5),
            retry_policy=_make_retry_policy(node.get("retry")),
        )

        publish(run_id, {
            "event": "node_routed",
            "run_id": run_id,
            "from": node["id"],
            "to": node.get("next"),
        })
        return result, node.get("next")

    # ── Decision ──────────────────────────────────────────────────────────────

    async def _run_decision(
        self, node: dict, ctx: dict, run_id: str
    ) -> tuple[dict, str | None]:
        result = await workflow.execute_activity(
            decision_activity,
            {
                "run_id": run_id,
                "node_id": node["id"],
                "expression": node.get("expression"),
                "cases": [
                    {"condition": c["condition"],
                     "target": c["target"],
                     "label": c.get("label")}
                    for c in (node.get("cases") or [])
                ],
                "default": node.get("default"),
                "context": ctx,
            },
            start_to_close_timeout=timedelta(seconds=15),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

        # Resolve next node
        if node.get("cases"):
            # Multi-way: activity returns {"target": node_id, "branch": label}
            next_id = result.get("target") or node.get("default")
        else:
            # Binary: activity returns {"branch": "true"|"false"}
            branch = result["branch"]
            next_id = node.get("branches", {}).get(branch)

        publish(run_id, {
            "event": "node_routed",
            "run_id": run_id,
            "from": node["id"],
            "to": next_id,
            "reason": f"branch={result.get('branch')}",
        })
        return result, next_id

    # ── Human task ────────────────────────────────────────────────────────────

    async def _run_human_task(
        self, node: dict, ctx: dict, task_queue_url: str, run_id: str
    ) -> tuple[dict, str | None]:
        # skip_if — auto-complete without creating a task
        skip_cfg = node.get("skip_if")
        if skip_cfg:
            try:
                should_skip = _eval_condition(skip_cfg["condition"], ctx)
            except Exception:
                should_skip = False

            if should_skip:
                auto_res = skip_cfg.get("auto_resolution", "accept")
                result = {
                    "resolution": auto_res,
                    "resolved_by": "system:skip-condition",
                    "skipped": True,
                    "skip_condition": skip_cfg["condition"],
                }
                publish(run_id, {
                    "event": "node_skipped",
                    "run_id": run_id,
                    "node_id": node["id"],
                    "reason": f"skip_if condition met: {skip_cfg['condition']}",
                })
                return result, node.get("next")

        tt = node.get("task_template", {})
        sla = node.get("sla_seconds", 3600)

        result = await workflow.execute_activity(
            human_task_activity,
            {
                "run_id": run_id,
                "node_id": node["id"],
                "task_queue_url": task_queue_url,
                "assignee_group": node.get("assignee_group", "ops"),
                "assignee_individual": node.get("assignee_individual"),
                "title": _resolve(tt.get("title", "Review required"), ctx),
                "description": _resolve(tt.get("description", ""), ctx),
                "actions": tt.get("actions", ["accept", "reject"]),
                "sla_seconds": sla,
                "priority": node.get("priority", "medium"),
                "form_schema": node.get("form_schema"),
                "evidence": node.get("evidence"),
                "escalation_policy": node.get("escalation_policy"),
                "context": ctx,
            },
            # SLA + escalation time + buffer
            start_to_close_timeout=timedelta(seconds=sla * 2 + 120),
            retry_policy=RetryPolicy(maximum_attempts=1),
        )

        publish(run_id, {
            "event": "node_routed",
            "run_id": run_id,
            "from": node["id"],
            "to": node.get("next"),
            "reason": f"resolution={result.get('resolution')}",
        })
        return result, node.get("next")
