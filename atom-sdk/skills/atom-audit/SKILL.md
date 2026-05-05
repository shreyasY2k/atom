---
name: atom-audit
description: Audit and error handling rules for all generated agents. Never suppress exceptions. Log actions with structured context. Retry rules for tool calls.
---

# ATOM Audit Rules

These rules apply to EVERY generated agent without exception.
All LLM calls, tool calls, and A2A calls are automatically recorded in the GATE audit log.

## Never suppress exceptions

```python
# CORRECT — surface the error
async def process_application(app_id: str) -> str:
    """Process a loan application."""
    result = await call_scoring_api(app_id)   # tool function
    if result is None:
        raise ValueError(f"Scoring API returned no result for {app_id}")
    return result

# WRONG — never do this
async def process_application(app_id: str) -> str:
    try:
        result = await call_scoring_api(app_id)
    except Exception:
        pass   # ← NEVER swallow exceptions silently
    return ""
```

## Structured logging

```python
import logging
logger = logging.getLogger(__name__)

# Log BEFORE significant actions
logger.info(
    "agent_action: approving loan",
    extra={
        "action": "approve_loan",
        "customer_id": cid,
        "amount": amount,
    }
)
```

Logs flow to Kafka `atom.audit` via atom-runtime automatically.
**Do NOT write audit records to files or external services directly.**

## Tool function error handling

Tool functions registered in Toolkit should raise on failure:

```python
async def fetch_credit_score(customer_id: str) -> str:
    """Fetch credit score from bureau."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{BUREAU_URL}/score/{customer_id}")
    if resp.status_code == 404:
        raise ValueError(f"Customer {customer_id} not found in bureau")
    if resp.status_code != 200:
        raise RuntimeError(f"Bureau API error {resp.status_code}: {resp.text}")
    return resp.text
```

The ReAct loop will surface the exception to the LLM so it can handle gracefully.

## Retry rules

- Tool calls: max 1 retry on `5xx`, **no retry on `4xx`** (bad request / not found)
- A2A calls: no automatic retry — surface the error to the caller
- LLM calls: `AtomChatModel` handles retries internally — **do not** wrap in a retry loop

## HITL audit

`request_human_decision()` creates an immutable HITL record automatically.
Do not log it separately — it is already audited.

## What NOT to generate

- NEVER: `except Exception: pass`
- NEVER: `except Exception: continue`
- NEVER: a bare `try/except` with no re-raise or logging
- NEVER: `logging.disable()` or suppressing log levels
- NEVER: write audit data to a file or external service
- NEVER: catch a `401` or `403` from GATE and silently fall back
- NEVER: `asyncio.run()` inside an `async def` — use `await` instead
