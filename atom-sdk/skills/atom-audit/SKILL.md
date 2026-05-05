---
name: atom-audit
description: Use for all generated agents. Defines audit and error handling rules that must always be followed — never suppress exceptions, always surface tool errors, never bypass GATE even for logging.
---

# ATOM Audit Rules

These rules apply to EVERY generated agent without exception.

## Never suppress exceptions

```python
# CORRECT
result = agent.use_tool("risk-score", {"customer_id": cid})
if result.get("error"):
    raise RuntimeError(f"risk-score tool failed: {result['error']}")

# WRONG — never do this
try:
    result = agent.use_tool("risk-score", {"customer_id": cid})
except Exception:
    pass  # ← NEVER suppress silently
```

## Always log decisions with context

```python
import logging
logger = logging.getLogger(__name__)

# Log before any significant action
logger.info("agent_action", extra={
    "action": "approve_loan",
    "customer_id": cid,
    "amount": amount,
    "model_confidence": confidence,
})
```

Logs are collected by atom-runtime and forwarded to Kafka `atom.audit` topic automatically.
Do NOT write to a file or external service directly.

## Retry rules

- Tool calls: max 1 retry on `5xx`, no retry on `4xx`
- A2A calls: no automatic retry — surface the error to the caller
- LLM calls: `AtomChatModel` handles retries internally — do not wrap in a retry loop

## What NOT to generate

- NEVER: `except Exception: pass`
- NEVER: `except Exception: continue`
- NEVER: a bare `try/except` with no re-raise or logging
- NEVER: `logging.disable()` or suppressing log levels
- NEVER: writing audit data to a file — it goes through GATE/Kafka automatically
- NEVER: catch a `401` or `403` from GATE and silently fall back to a different path
