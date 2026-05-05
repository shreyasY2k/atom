---
name: atom-hitl
description: Human-in-the-loop escalation using request_human_decision(). Blocks until a reviewer approves or rejects. Include in any agent that needs approval before irreversible or high-value actions.
---

# ATOM Human-in-the-Loop (HITL)

## Import

```python
from agentscope.hitl import request_human_decision
```

## Full signature

```python
def request_human_decision(
    payload: dict[str, Any],   # context shown to the reviewer
    timeout_s: int = 300,      # seconds to wait (default 5 min)
    poll_interval_s: int = 5,  # how often to poll
) -> dict[str, Any]:
    # Returns: {"approved": bool, "note": str, "decided_by": str, "decided_at": str}
    # Raises:  TimeoutError if no decision within timeout_s
    #          EnvironmentError if ATOM env vars not set
```

## When to trigger HITL

Escalate when the action is:
- **Irreversible** — deletes data, sends communications, makes financial transactions
- **High-value** — monetary amount above a threshold set by the agent intent
- **Low-confidence** — model uncertainty is high
- **Explicitly required** — user description says "escalate to human" or "require approval"

## Correct usage

```python
from agentscope.hitl import request_human_decision
import logging

logger = logging.getLogger(__name__)

async def approve_loan(customer_id: str, amount: float) -> str:
    """Approve a loan after human review."""

    # Trigger HITL before the irreversible action
    try:
        decision = request_human_decision(
            payload={
                "action": "approve_loan",
                "customer_id": customer_id,
                "amount": amount,
                "currency": "USD",
            },
            timeout_s=300,
        )
    except TimeoutError:
        logger.warning("HITL timed out for customer=%s", customer_id)
        return "Approval timed out. Action not taken — please retry."

    if decision["approved"]:
        # Proceed only after explicit approval
        logger.info("Loan approved by %s", decision["decided_by"])
        # ... execute the action
        return f"Loan of ${amount} approved."
    else:
        note = decision.get("note", "No reason given")
        logger.info("Loan rejected: %s", note)
        return f"Loan rejected: {note}"
```

## As a tool function registered in Toolkit

HITL works naturally inside a tool function that the ReAct agent calls:

```python
async def submit_transfer(account_id: str, amount: float, target: str) -> str:
    """Submit a funds transfer — requires human approval above $10,000."""
    if amount > 10_000:
        decision = request_human_decision(
            payload={"account": account_id, "amount": amount, "target": target},
            timeout_s=600,
        )
        if not decision["approved"]:
            return "Transfer rejected by reviewer."

    # Execute transfer
    ...
    return "Transfer complete."

toolkit.register_tool_function(submit_transfer, group_name="finance")
```

## Rules

- NEVER proceed with a high-risk action if `decision["approved"]` is `False`
- NEVER retry `request_human_decision` for the same action in the same session
- ALWAYS include enough context in `payload` for the reviewer to make an informed decision
- On `TimeoutError` — default safe behaviour is to NOT proceed; make this explicit
- `request_human_decision` is synchronous (blocks); do not wrap in `asyncio.run()`
