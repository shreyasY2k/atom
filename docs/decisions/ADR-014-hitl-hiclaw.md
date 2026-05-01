# ADR-014 — HITL via HiClaw Integration

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

BFSI agents frequently reach decision points that require human approval before proceeding
(e.g. "approve this loan amount", "confirm this transaction", "release these funds").
This is called Human-in-the-Loop (HITL).

agentscope already ships HiClaw — a HITL workflow engine integrated with the agentscope
agent lifecycle.

## Decision

Use **HiClaw** (from agentscope) as the HITL workflow engine, extended with a custom
atom-studio UI for decision dashboards.

HITL flow:
1. Agent code calls `hitl.request(payload, timeout=300)` using atom-sdk's HiClaw binding.
2. HiClaw creates a pending decision record in Postgres (`hitl_workflows` table).
3. atom-studio's HITL dashboard shows the pending decision to the assigned human reviewer.
4. Reviewer approves or rejects via the dashboard UI (REST call → studio backend → Postgres).
5. GATE is notified; the HITL record is resolved; HiClaw returns the decision to the agent.
6. The entire HITL event is logged to the audit chain.

The same mechanism is reused for **deployment approvals**: `atom deploy` creates a HITL record
of type `DEPLOYMENT_APPROVAL`, which appears in the studio dashboard for the platform admin.

## Consequences

- **Positive:** HITL is a first-class feature, not an afterthought; reuses battle-tested
  HiClaw internals; deployment approval and business HITL share one implementation.
- **Negative:** HiClaw adds coupling between atom-sdk and atom-studio.
  Agents that exceed their HITL timeout will need a defined fallback behaviour
  (configurable per agent: `ABORT` | `CONTINUE` | `ESCALATE`).

## Implementation Note

HiClaw's original UI widgets are replaced by the atom-studio HITL dashboard.
The HiClaw backend protocol (polling / callback) is preserved unchanged.
