"""
Workflow spec validation — all 9 rules plus BFSI human-gate invariant.
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
_VALID_GROUPS = {"ops", "compliance", "risk-management", "audit"}

BUILDER_URL = os.environ.get("BUILDER_BACKEND_URL", "http://builder-backend:8080")


def validate(spec: WorkflowSpec, check_agents: bool = False) -> list[dict]:
    """Return list of {node_id, reason} errors. Empty = valid."""
    errors: list[dict] = []
    nodes = spec.spec.nodes
    node_ids = {n.id for n in nodes}

    # Rule 2: unique IDs
    seen: set[str] = set()
    for n in nodes:
        if n.id in seen:
            errors.append({"node_id": n.id, "reason": "duplicate node ID"})
        seen.add(n.id)

    # Build adjacency
    reachable: set[str] = set()

    def _targets(n: WorkflowNode) -> list[Optional[str]]:
        t = []
        if n.branches:
            t.extend(n.branches.values())
        elif n.next is not None:
            t.append(n.next)
        if n.fallback_node:
            t.append(n.fallback_node)
        return t

    # Rule 3: all next/branch targets are valid node IDs
    for n in nodes:
        for target in _targets(n):
            if target is not None and target not in node_ids:
                errors.append({"node_id": n.id,
                                "reason": f"references unknown node '{target}'"})

    # Rule 4: exactly one terminal (next: null)
    terminals = [n for n in nodes if n.next is None and not n.branches]
    if len(terminals) == 0:
        errors.append({"node_id": "__graph__", "reason": "no terminal node (next: null)"})
    elif len(terminals) > 1:
        errors.append({"node_id": "__graph__",
                        "reason": f"multiple terminal nodes: {[t.id for t in terminals]}"})

    # Per-node rules
    for n in nodes:
        if n.type == "agent":
            # Rule 5a: confidence_threshold requires fallback_node
            if n.confidence_threshold is not None and not n.fallback_node:
                errors.append({"node_id": n.id,
                                "reason": "confidence_threshold set but fallback_node missing"})
            # Rule 5b: agent existence (optional, soft)
            if check_agents and n.agent_ref:
                try:
                    r = httpx.get(f"{BUILDER_URL}/agents/{n.agent_ref.name}", timeout=5)
                    if r.status_code == 404:
                        errors.append({"node_id": n.id,
                                       "reason": f"agent '{n.agent_ref.name}' not found in registry "
                                                  "(deploy it before running)"})
                    elif r.is_success and r.json().get("status") != "deployed":
                        errors.append({"node_id": n.id,
                                       "reason": f"agent '{n.agent_ref.name}' is registered but "
                                                  f"not deployed (status={r.json().get('status')})"})
                except Exception:
                    pass  # soft: builder may be unreachable

        elif n.type == "decision":
            # Rule 6: safe expression
            if not n.expression:
                errors.append({"node_id": n.id, "reason": "decision node has no expression"})
            else:
                expr_errors = _validate_expression(n.id, n.expression)
                errors.extend(expr_errors)
            if not n.branches or "true" not in n.branches or "false" not in n.branches:
                errors.append({"node_id": n.id,
                                "reason": "decision node must have branches.true and branches.false"})

        elif n.type == "human_task":
            # Rule 7
            if n.assignee_group not in _VALID_GROUPS:
                errors.append({"node_id": n.id,
                                "reason": f"assignee_group '{n.assignee_group}' not in "
                                          f"{sorted(_VALID_GROUPS)}"})
            if n.task_template:
                for action in n.task_template.actions:
                    if action not in ("accept", "reject", "edit"):
                        errors.append({"node_id": n.id,
                                       "reason": f"invalid action '{action}'"})

    # Rule 8: BFSI human-gate invariant
    bfsi_errors = _check_bfsi_invariant(nodes, node_ids)
    errors.extend(bfsi_errors)

    # Rule 9: retention_days already enforced by Pydantic schema

    return errors


def _validate_expression(node_id: str, expr: str) -> list[dict]:
    """Ensure the decision expression uses only safe AST constructs."""
    errors = []
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        return [{"node_id": node_id, "reason": f"expression syntax error: {e}"}]

    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            errors.append({"node_id": node_id,
                           "reason": "expression must not contain function calls"})
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            errors.append({"node_id": node_id, "reason": "expression must not contain imports"})
        if isinstance(node, ast.Attribute):
            # Only allow ctx.* style access (one-level: ctx.foo or ctx.foo.bar)
            val = node.value
            while isinstance(val, ast.Attribute):
                val = val.value
            if not (isinstance(val, ast.Name) and val.id == "ctx"):
                errors.append({"node_id": node_id,
                               "reason": "attribute access only allowed on 'ctx'"})
    return errors


def _check_bfsi_invariant(nodes: list[WorkflowNode],
                          node_ids: set[str]) -> list[dict]:
    """
    Every path that reaches a state-changing http call (non-GET to a
    state-changing service) must have a human_task node immediately
    before or after it.
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

        # Check immediate predecessors (any node whose next/branch/fallback points here)
        predecessors = [
            p for p in nodes
            if n.id in ([p.next] + list((p.branches or {}).values()) +
                        ([p.fallback_node] if p.fallback_node else []))
        ]
        pred_has_human = any(p.id in human_ids for p in predecessors)

        # Check immediate successors
        successors = [node_map[t] for t in ([n.next] if n.next else [])
                      + list((n.branches or {}).values())
                      if t and t in node_map]
        succ_has_human = any(s.id in human_ids for s in successors)

        if not (pred_has_human or succ_has_human):
            errors.append({
                "node_id": n.id,
                "reason": (f"BFSI invariant: state-changing http call to '{svc}' "
                           "has no adjacent human_task node"),
            })
    return errors


def _extract_service(url: str) -> str:
    """Extract the service hostname from a URL template."""
    # http://service-name:port/... → service-name
    import re
    m = re.search(r"https?://([a-zA-Z0-9_-]+)", url)
    return m.group(1) if m else ""
