---
name: atom-gate-calls
description: How tools work in ATOM — register Python functions into Toolkit, the ReAct loop calls them automatically through GATE. Never call tools manually or make direct HTTP calls.
---

# ATOM GATE Calls

## Core rule

Every outbound call from an agent goes through GATE automatically.
**You do not call tools manually.** Register them into the Toolkit; the ReAct loop invokes them.

## Registering a tool function

```python
from agentscope.tool import Toolkit

async def risk_score(customer_id: str, loan_amount: float) -> str:
    """Calculate risk score for a loan application.

    Args:
        customer_id: The customer's unique identifier.
        loan_amount: Requested loan amount in USD.

    Returns:
        JSON string with risk_score (0-100) and recommendation.
    """
    # Your implementation — GATE handles auth and routing automatically
    import httpx
    # All requests go through ATOM_GATE_URL automatically via the SDK
    ...

toolkit = Toolkit()
toolkit.register_tool_function(risk_score, group_name="basic")
```

**Rules for tool functions:**
- Must have a proper docstring — the LLM reads it to decide when/how to call the tool
- Argument types must be annotatable (str, int, float, list, dict)
- Return a string or JSON-serialisable value
- Can be `async def` or `def`

## Tool groups

All tools start in the `"basic"` group (always active). Use named groups for optional capabilities:

```python
toolkit.create_tool_group("crm", "CRM integration tools", active=False)
toolkit.register_tool_function(lookup_customer, group_name="crm")
toolkit.register_tool_function(update_customer, group_name="crm")

# Activate group for all subsequent calls
toolkit.update_tool_groups(["crm"], active=True)
```

## Dynamic tool activation (meta tool)

With `enable_meta_tool=True`, the agent itself can activate/deactivate tool groups:

```python
agent = ReActAgent(
    ...,
    toolkit=toolkit,
    enable_meta_tool=True,   # agent can call reset_equipped_tools()
)
```

## Error handling for tools

Tool functions should raise exceptions on failure — **never return an error silently**:

```python
async def lookup_customer(customer_id: str) -> str:
    result = await call_crm_api(customer_id)
    if not result:
        raise ValueError(f"Customer {customer_id} not found")
    return json.dumps(result)
```

The ReAct loop surfaces tool errors to the LLM so it can handle them gracefully.

## What NOT to generate

- NEVER: `agent.use_tool("tool-name", {...})` — this method does not exist
- NEVER: `import requests; requests.post(...)` — direct HTTP bypasses GATE
- NEVER: `import httpx; httpx.post(url, ...)` — direct HTTP bypasses GATE
- NEVER: construct `ATOM_GATE_URL` manually in agent code
- NEVER: return `None` or empty string from a tool on failure — raise instead
