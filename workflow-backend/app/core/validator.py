"""
Workflow spec validation — structural rules, type rules, and safety invariants.
Returns a list of {node_id, reason} dicts; empty list = valid.
"""

from __future__ import annotations
import ast
import os
from typing import Optional

import httpx

from app.core.schema import WorkflowSpec, WorkflowNode

# Services whose non-GET calls require an adjacent human_task gate
_STATE_CHANGING_SERVICES = {"swift-gw"}

# Permitted assignee groups
_VALID_GROUPS = {"ops", "compliance", "risk-management", "audit", "risk", "legal"}

BUILDER_URL = os.environ.get("BUILDER_BACKEND_URL", "http://builder-backend:8080")


def validate(spec: WorkflowSpec, check_agents: bool = False) -> list[dict]:
    """Return list of {node_id, reason} errors. Empty = valid."""
    errors: list[dict] = []
    nodes = spec.spec.nodes
    node_ids = {n.id for n in nodes}

    # ── Rule: unique node IDs ─────────────────────────────────────────────────
    seen: set[str] = set()
    for n in nodes:
        if n.id in seen:
            errors.append({"node_id": n.id, "reason": "duplicate node ID"})
        seen.add(n.id)

    # ── Collect all referenced targets ────────────────────────────────────────
    def _targets(n: WorkflowNode) -> list[Optional[str]]:
        t: list[Optional[str]] = []
        if n.branches:
            t.extend(n.branches.values())
        elif n.next is not None:
            t.append(n.next)
        if n.fallback_node:
            t.append(n.fallback_node)
        if n.on_error:
            t.append(n.on_error)
        if n.cases:
            t.extend(c.target for c in n.cases)
        if n.default:
            t.append(n.default)
        return t

    # ── Rule: all targets must be valid node IDs ──────────────────────────────
    for n in nodes:
        for target in _targets(n):
            if target is not None and target not in node_ids:
                errors.append({"node_id": n.id,
                                "reason": f"references unknown node '{target}'"})

    # ── Rule: at least one terminal node (next: null, no branches) ────────────
    terminals = [n for n in nodes if n.next is None and not n.branches and not n.cases]
    if len(terminals) == 0:
        errors.append({"node_id": "__graph__", "reason": "no terminal node (next: null)"})

    # ── Rule: workflow-level error_handler must reference a valid node ─────────
    if spec.spec.error_handler and spec.spec.error_handler not in node_ids:
        errors.append({"node_id": "__workflow__",
                        "reason": f"error_handler '{spec.spec.error_handler}' not a valid node ID"})

    # ── Per-node rules ────────────────────────────────────────────────────────
    for n in nodes:
        # on_error must be a valid node
        if n.on_error and n.on_error not in node_ids:
            errors.append({"node_id": n.id,
                            "reason": f"on_error '{n.on_error}' not a valid node ID"})

        if n.type == "agent":
            errors.extend(_validate_agent_node(n, node_ids, check_agents))

        elif n.type == "http":
            errors.extend(_validate_http_node(n))

        elif n.type == "decision":
            errors.extend(_validate_decision_node(n, node_ids))

        elif n.type == "human_task":
            errors.extend(_validate_human_task_node(n, node_ids))

    # ── Safety human-gate invariant ──────────────────────────────────────────
    errors.extend(_check_safety_invariant(nodes, node_ids))

    return errors


# ── Agent validation ──────────────────────────────────────────────────────────

def _validate_agent_node(n: WorkflowNode, node_ids: set[str],
                          check_agents: bool) -> list[dict]:
    errors = []
    if n.confidence_threshold is not None and not n.fallback_node:
        errors.append({"node_id": n.id,
                        "reason": "confidence_threshold set but fallback_node missing"})

    if check_agents and n.agent_ref:
        try:
            r = httpx.get(f"{BUILDER_URL}/agents/{n.agent_ref.name}", timeout=5)
            if r.status_code == 404:
                errors.append({"node_id": n.id,
                               "reason": f"agent '{n.agent_ref.name}' not found in registry"})
            elif r.is_success and r.json().get("status") != "deployed":
                errors.append({"node_id": n.id,
                               "reason": f"agent '{n.agent_ref.name}' not deployed "
                                          f"(status={r.json().get('status')})"})
        except Exception:
            pass

    if n.retry and n.retry.max_attempts < 1:
        errors.append({"node_id": n.id, "reason": "retry.max_attempts must be >= 1"})

    return errors


# ── HTTP validation ───────────────────────────────────────────────────────────

def _validate_http_node(n: WorkflowNode) -> list[dict]:
    errors = []
    if not n.url_template:
        errors.append({"node_id": n.id, "reason": "http node missing url_template"})
    if not n.method:
        errors.append({"node_id": n.id, "reason": "http node missing method"})

    if n.auth:
        auth = n.auth
        if auth.type == "bearer" and not auth.token:
            errors.append({"node_id": n.id, "reason": "auth.type=bearer requires auth.token"})
        if auth.type == "basic" and (not auth.username or not auth.password):
            errors.append({"node_id": n.id,
                            "reason": "auth.type=basic requires auth.username and auth.password"})
        if auth.type == "api_key" and not auth.key:
            errors.append({"node_id": n.id, "reason": "auth.type=api_key requires auth.key"})

    if n.poll:
        if not n.poll.done_condition:
            errors.append({"node_id": n.id, "reason": "poll.done_condition is required"})
        # done_condition is an expression; validate it
        errors.extend(_validate_expression(n.id, n.poll.done_condition))

    if n.retry and n.retry.max_attempts < 1:
        errors.append({"node_id": n.id, "reason": "retry.max_attempts must be >= 1"})

    return errors


# ── Decision validation ───────────────────────────────────────────────────────

def _validate_decision_node(n: WorkflowNode, node_ids: set[str]) -> list[dict]:
    errors = []

    has_binary = bool(n.expression and n.branches)
    has_cases  = bool(n.cases)

    if not has_binary and not has_cases:
        errors.append({"node_id": n.id,
                        "reason": "decision node must have either expression+branches "
                                  "or cases (multi-way)"})
        return errors

    if has_cases:
        # Multi-way decision
        if not n.default:
            errors.append({"node_id": n.id,
                            "reason": "multi-way decision (cases) requires a 'default' branch"})
        for i, case in enumerate(n.cases):
            errors.extend(_validate_expression(n.id, case.condition,
                                               suffix=f" (cases[{i}])"))
            if case.target not in node_ids:
                errors.append({"node_id": n.id,
                                "reason": f"cases[{i}].target '{case.target}' not a valid node ID"})

    if has_binary:
        # Binary decision
        errors.extend(_validate_expression(n.id, n.expression))
        if not n.branches or "true" not in n.branches or "false" not in n.branches:
            errors.append({"node_id": n.id,
                            "reason": "binary decision must have branches.true and branches.false"})

    return errors


# ── Human-task validation ─────────────────────────────────────────────────────

def _validate_human_task_node(n: WorkflowNode, node_ids: set[str]) -> list[dict]:
    errors = []

    if not n.assignee_group and not n.assignee_individual:
        errors.append({"node_id": n.id,
                        "reason": "human_task requires assignee_group or assignee_individual"})

    if n.assignee_group and n.assignee_group not in _VALID_GROUPS:
        errors.append({"node_id": n.id,
                        "reason": f"assignee_group '{n.assignee_group}' not in "
                                  f"{sorted(_VALID_GROUPS)}"})

    if n.task_template:
        for action in n.task_template.actions:
            if action not in ("accept", "reject", "edit"):
                errors.append({"node_id": n.id,
                               "reason": f"invalid action '{action}'"})

    if n.escalation_policy:
        ep = n.escalation_policy
        if ep.action == "escalate" and not ep.escalate_to_group:
            errors.append({"node_id": n.id,
                            "reason": "escalation_policy.action=escalate requires "
                                      "escalation_policy.escalate_to_group"})
        if ep.escalate_to_group and ep.escalate_to_group not in _VALID_GROUPS:
            errors.append({"node_id": n.id,
                            "reason": f"escalation_policy.escalate_to_group "
                                       f"'{ep.escalate_to_group}' not in {sorted(_VALID_GROUPS)}"})

    if n.skip_if:
        errors.extend(_validate_expression(n.id, n.skip_if.condition,
                                           suffix=" (skip_if.condition)"))

    return errors


# ── Expression safety ─────────────────────────────────────────────────────────

def _validate_expression(node_id: str, expr: str, suffix: str = "") -> list[dict]:
    """Ensure the expression uses only safe AST constructs."""
    errors = []
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        return [{"node_id": node_id,
                 "reason": f"expression syntax error{suffix}: {e}"}]

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            errors.append({"node_id": node_id,
                           "reason": f"expression must not contain function calls{suffix}"})
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            errors.append({"node_id": node_id,
                           "reason": f"expression must not contain imports{suffix}"})
        if isinstance(node, ast.Attribute):
            val = node.value
            while isinstance(val, ast.Attribute):
                val = val.value
            if not (isinstance(val, ast.Name) and val.id == "ctx"):
                errors.append({"node_id": node_id,
                               "reason": f"attribute access only allowed on 'ctx'{suffix}"})
    return errors


# ── Safety human-gate invariant ──────────────────────────────────────────────

def _check_safety_invariant(nodes: list[WorkflowNode],
                             node_ids: set[str]) -> list[dict]:
    """
    Every path reaching a state-changing http call must have a human_task
    node immediately before or after it.
    """
    errors = []
    node_map = {n.id: n for n in nodes}
    human_ids = {n.id for n in nodes if n.type == "human_task"}

    for n in nodes:
        if n.type != "http" or n.method == "GET":
            continue
        url = n.url_template or ""
        svc = _extract_service(url)
        if svc not in _STATE_CHANGING_SERVICES:
            continue

        predecessors = [
            p for p in nodes
            if n.id in (
                [p.next]
                + list((p.branches or {}).values())
                + ([p.fallback_node] if p.fallback_node else [])
                + [c.target for c in (p.cases or [])]
                + ([p.default] if p.default else [])
            )
        ]
        pred_has_human = any(p.id in human_ids for p in predecessors)

        successors = [
            node_map[t] for t in (
                [n.next] if n.next else []
            ) + list((n.branches or {}).values())
            if t and t in node_map
        ]
        succ_has_human = any(s.id in human_ids for s in successors)

        if not (pred_has_human or succ_has_human):
            errors.append({
                "node_id": n.id,
                "reason": (f"Safety invariant: state-changing http call to '{svc}' "
                            "has no adjacent human_task node"),
            })
    return errors


def _extract_service(url: str) -> str:
    import re
    m = re.search(r"https?://([a-zA-Z0-9_-]+)", url)
    return m.group(1) if m else ""
