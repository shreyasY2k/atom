---
name: atom-gate-calls
description: Use when an agent needs to call tools or external services. All tool calls and LLM calls must go through GATE. Provides the correct use_tool() pattern and explains what never to do.
---

# ATOM GATE Calls

## Core rule

Every outbound call from an agent — tool invocations, LLM calls — goes through GATE.
The agent never makes direct HTTP calls to external services, databases, or APIs.

## Calling a tool

```python
# atom-sdk handles GATE routing automatically via use_tool()
result = agent.use_tool("tool-name", {"param1": "value1", "param2": "value2"})
```

`use_tool()` internally constructs:
```
POST {ATOM_GATE_URL}/domain/{ATOM_DOMAIN_ID}/agent/{ATOM_AGENT_ID}/tools/invoke
Authorization: Bearer {ATOM_AGENT_JWT}
{ "tool": "tool-name", "input": { ... } }
```

The agent never constructs this URL manually. Always use `use_tool()`.

## Handling tool responses

```python
result = agent.use_tool("lookup-customer", {"customer_id": cid})
if result.get("error"):
    # handle gracefully — do NOT retry more than 2 times
    raise RuntimeError(f"Tool error: {result['error']}")
data = result["output"]
```

## Error handling rules

- On `401` from GATE: the agent JWT may be expired — do NOT retry, raise immediately
- On `403` from GATE: the tool is not in this agent's allowed list — do NOT retry, raise immediately
- On `429` from GATE: rate limited — wait `retry_after` seconds, retry once only
- On `5xx` from GATE: retry once after 2 seconds, then raise
- NEVER silently swallow a GATE error

## What NOT to generate

- NEVER: `import requests` and call an external URL directly
- NEVER: `import httpx` and call an external URL directly
- NEVER: construct `ATOM_GATE_URL` + path manually in agent code
- NEVER: pass the JWT as a query parameter or in the body
