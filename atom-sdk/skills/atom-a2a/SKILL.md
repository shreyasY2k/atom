---
name: atom-a2a
description: Agent-to-Agent communication using A2AAgent and WellKnownAgentCardResolver. There is no a2a_call() function — use A2AAgent constructed from an AgentCard. All A2A goes through GATE.
---

# ATOM Agent-to-Agent (A2A)

## How A2A works in atom-sdk

A2A is not a function call — it is an agent instance (`A2AAgent`) that represents
a remote agent. You call it like any local agent: `await a2a_agent.reply(msg)`.
GATE handles routing, JWT validation, and audit automatically.

## Imports

```python
from agentscope.agent import A2AAgent
from agentscope.a2a import WellKnownAgentCardResolver
```

## Constructing an A2AAgent

```python
from agentscope.agent import A2AAgent
from agentscope.a2a import WellKnownAgentCardResolver

# Resolve the remote agent's card (metadata + endpoint) via GATE
resolver = WellKnownAgentCardResolver(
    base_url=os.environ["ATOM_GATE_URL"],
    agent_card_path=f"/domain/{domain_id}/agent/{target_agent_id}/.well-known/agent",
)
agent_card = await resolver.get_agent_card()

# Create A2A agent wrapper
remote_kyc_agent = A2AAgent(agent_card=agent_card)
```

## Calling a remote agent

```python
from agentscope.message import Msg

# Build a message
request_msg = Msg(
    name="credit-agent",
    content="Verify KYC for customer CUST-4821",
    role="user",
)

# Call — blocks until response
response = await remote_kyc_agent.reply(request_msg)
result_text = response.get_text_content()
```

## A2A inside a tool function

The clean pattern is to wrap A2A calls as Toolkit tool functions:

```python
async def verify_kyc(customer_id: str) -> str:
    """Verify KYC status for a customer by calling the KYC agent.

    Args:
        customer_id: Customer identifier.

    Returns:
        KYC verification result as JSON string.
    """
    resolver = WellKnownAgentCardResolver(
        base_url=os.environ["ATOM_GATE_URL"],
        agent_card_path=f"/domain/{os.environ['ATOM_DOMAIN_ID']}/agent/{KYC_AGENT_ID}/.well-known/agent",
    )
    agent_card = await resolver.get_agent_card()
    kyc_agent = A2AAgent(agent_card=agent_card)

    response = await kyc_agent.reply(
        Msg(name="caller", content=f"Verify KYC for {customer_id}", role="user")
    )
    return response.get_text_content() or "No response"

toolkit.register_tool_function(verify_kyc, group_name="kyc")
```

## Getting target agent IDs

Target agent IDs come from `atom_agent.yaml`:

```yaml
# atom_agent.yaml
a2a_targets:
  - name: kyc-agent
    agent_id: "uuid-of-kyc-agent"
    domain_id: "uuid-of-domain"
```

```python
import yaml, os

with open("atom_agent.yaml") as f:
    config = yaml.safe_load(f)

a2a = {t["name"]: t for t in config.get("a2a_targets", [])}
KYC_AGENT_ID = a2a["kyc-agent"]["agent_id"]
```

## File-based A2A (for testing)

```python
from agentscope.a2a import FileAgentCardResolver

resolver = FileAgentCardResolver(file_path="/path/to/agent-card.json")
agent_card = await resolver.get_agent_card()
```

## Rules

- NEVER: `from agentscope.a2a import a2a_call` — `a2a_call` does not exist
- NEVER: `import requests; requests.post(other_agent_url, ...)` — bypasses GATE
- NEVER: hardcode another agent's JWT or endpoint URL
- ALWAYS: resolve the agent card via GATE (`WellKnownAgentCardResolver`) so GATE can audit
- A2A targets must be declared in `atom_agent.yaml` and registered in Postgres
