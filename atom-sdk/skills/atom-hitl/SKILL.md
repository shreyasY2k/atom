---
name: atom-hitl
description: Use when an agent needs to pause and wait for a human decision before proceeding. Covers the correct request_human_decision() call, when to trigger it, and how to handle the response including timeout behaviour.
---

# ATOM Human-in-the-Loop (HITL)

## Import

```python
from agentscope.hitl import request_human_decision
```

## When to trigger HITL

Generate HITL escalation when the agent needs human approval for:
- Transactions or actions above a threshold (e.g. amount > 50,000)
- Irreversible actions (delete, transfer, approve)
- Low-confidence decisions (model uncertainty above a threshold)
- Any action the user specified as requiring human review

## Correct usage

```python
decision = request_human_decision(
    payload={
        "action": "approve_loan",          # what the agent wants to do
        "amount": 75000,                   # relevant data for reviewer
        "customer_id": "CUST-4821",
        "reason": "Credit score 720, income verified",
    },
    timeout_s=300,                         # how long to wait (default 300s)
)

if decision["approved"]:
    # proceed with the action
    result = agent.use_tool("approve-loan", {"customer_id": "CUST-4821"})
else:
    # handle rejection gracefully
    note = decision.get("note", "No reason given")
    return f"Action rejected by reviewer: {note}"
```

## Timeout handling

```python
# request_human_decision raises TimeoutError if no decision in timeout_s
try:
    decision = request_human_decision(payload=payload, timeout_s=300)
except TimeoutError:
    # default safe behaviour: treat as rejected, do NOT proceed
    return "Decision timed out — action not taken. Please retry."
```

## Rules

- NEVER proceed with a high-risk action if `decision["approved"]` is False
- NEVER retry `request_human_decision` for the same action in the same session
- ALWAYS include enough context in `payload` for the reviewer to make a decision
- The `timeout_s` should be appropriate to the urgency — default 300s is safe
- `request_human_decision` routes through GATE internally — do NOT call the HITL API directly
