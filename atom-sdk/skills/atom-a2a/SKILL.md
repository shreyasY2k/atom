---
name: atom-a2a
description: Use when an agent needs to call another ATOM agent (Agent-to-Agent). All A2A calls go via GATE — never direct pod-to-pod. Covers the correct a2a_call() usage, JWT handling, and error patterns.
---

# ATOM Agent-to-Agent (A2A)

## Import

```python
from agentscope.a2a import a2a_call
```

## Core rule

An agent NEVER calls another agent directly. All A2A calls go through GATE.
GATE validates the calling agent's JWT, checks OPA policy (cross-domain rules),
rate-limits, and appends to the audit chain before proxying to the target.

## Correct usage

```python
# Call another agent by its agent_id (from atom_agent.yaml or env)
response = a2a_call(
    target_agent_id="agent-uuid-of-kyc-agent",
    payload={"customer_id": "CUST-4821", "check_type": "full_kyc"},
)

if response.get("error"):
    raise RuntimeError(f"A2A call failed: {response['error']}")

kyc_result = response["output"]
```

## How it works internally

`a2a_call()` constructs:
```
POST {ATOM_GATE_URL}/domain/{ATOM_DOMAIN_ID}/agent/{ATOM_AGENT_ID}/a2a/{target_agent_id}
Authorization: Bearer {ATOM_AGENT_JWT}
X-ATOM-Caller-Agent-ID: {ATOM_AGENT_ID}
{ "payload": { ... } }
```

The calling agent never needs to know the target's URL, JWT, or k8s address.
GATE resolves all of this.

## Getting target agent IDs

Target agent IDs come from `atom_agent.yaml` — specified at build time, not hardcoded:

```yaml
# atom_agent.yaml
a2a_targets:
  - name: kyc-agent
    agent_id: "uuid-of-kyc-agent"
```

```python
import os, yaml

with open("atom_agent.yaml") as f:
    config = yaml.safe_load(f)

a2a = {t["name"]: t["agent_id"] for t in config.get("a2a_targets", [])}
kyc_agent_id = a2a["kyc-agent"]
```

## Error handling

- `403`: calling agent is not permitted to call target — do NOT retry, raise immediately
- `404`: target agent not found or not deployed — raise with clear message
- `timeout`: default 30s — raise `TimeoutError`, do NOT retry automatically

## Rules

- NEVER use `requests.post()` or `httpx.post()` to call another agent's endpoint
- NEVER store or hardcode another agent's JWT
- NEVER call `{ATOM_GATE_URL}/domain/.../agent/{target_id}/run` directly — use `a2a_call()`
- A2A targets must be declared in `atom_agent.yaml` — they are registered in Postgres and validated by OPA
