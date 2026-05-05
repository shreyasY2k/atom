# ATOM Skills — Content for Claude Code
#
# Each section below is the exact content of one SKILL.md file.
# Path shown in the comment above each block.
# Commit each to atom-sdk/skills/<name>/SKILL.md

# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-react-agent/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

---
name: atom-react-agent
description: Use when generating agent.py for an ATOM agent. Provides the correct ReActAgent constructor, AtomChatModel wiring, and import paths for atom-sdk. Never use vanilla agentscope imports — always use atom-sdk patterns.
---

# ATOM ReAct Agent

## Correct imports

```python
from agentscope.agents import ReActAgent
from agentscope.models import AtomChatModel
from agentscope.tool import Toolkit
from agentscope.memory import InMemoryMemory
```

## Correct agent construction

```python
def build_agent(name: str, sys_prompt: str, model_name: str, toolkit: Toolkit) -> ReActAgent:
    return ReActAgent(
        name=name,
        sys_prompt=sys_prompt,
        model=AtomChatModel(model_name=model_name),
        memory=InMemoryMemory(),
        toolkit=toolkit,
    )
```

## AtomChatModel rules

- ALWAYS use `AtomChatModel` — never `OpenAIChatModel`, `LiteLLMModel`, or any other model class
- NEVER pass `api_key`, `base_url`, or `client_kwargs` to `AtomChatModel` — these are injected from env vars automatically
- The `model_name` must match an entry in atom-llm's `model_list` config (e.g. `"gemini-2.5-flash"`)
- `AtomChatModel` reads `ATOM_GATE_URL`, `ATOM_DOMAIN_ID`, `ATOM_AGENT_ID`, `ATOM_AGENT_JWT` from environment — all injected by atom-runtime at pod start
- For local dev, these are set in the agent's `.env` file

## Entry point pattern

```python
# agent.py
import os
from agentscope.agents import ReActAgent
from agentscope.models import AtomChatModel
from agentscope.tool import Toolkit
from agentscope.memory import InMemoryMemory
from agentscope.message import Msg

def main():
    toolkit = Toolkit()
    # register tools and skills here

    agent = ReActAgent(
        name=os.environ.get("ATOM_AGENT_NAME", "agent"),
        sys_prompt="You are a helpful assistant.",
        model=AtomChatModel(model_name=os.environ.get("ATOM_MODEL", "gemini-2.5-flash")),
        memory=InMemoryMemory(),
        toolkit=toolkit,
    )

    # agent is now ready — atom-runtime wraps this in a serving loop
    return agent

if __name__ == "__main__":
    main()
```

## What NOT to generate

- NEVER: `import openai` or direct OpenAI SDK usage
- NEVER: `import litellm` directly in agent code
- NEVER: hardcode `ATOM_GATE_URL`, `ATOM_AGENT_JWT` or any credential in agent.py
- NEVER: use `agentscope.models.OpenAIChatModel` or `agentscope.models.LiteLLMModel`


# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-gate-calls/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-hitl/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-memory/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

---
name: atom-memory
description: Use when an agent needs to store facts across turns or recall relevant context before making a decision. Covers MemoryManager construction, remember(), recall(), and when to use short-term vs long-term memory.
---

# ATOM Memory

## Import

```python
from agentscope.hitl import MemoryManager
```

## Construction

```python
# MemoryManager reads all config from ATOM env vars — no arguments needed
memory = MemoryManager()
```

Reads from environment:
- `ATOM_MEMORY_BACKEND` — `pgvector` (long-term) or `redis` (short-term)
- `ATOM_DOMAIN_ID`, `ATOM_AGENT_ID` — for namespacing stored memories

## Storing facts

```python
# Store a string fact — goes to long-term pgvector storage
memory.remember("Customer 4821 has a credit limit of 75,000 and is KYC verified")

# Store with explicit key for later retrieval
memory.remember("last_transaction", "Transfer of 10,000 to ACC-9923 on 2025-01-15")
```

## Recalling context

```python
# Semantic search — returns top_k most relevant memories
memories = memory.recall("credit limit", top_k=3)
context = "\n".join(m["content"] for m in memories)

# Use recalled context in the LLM prompt
sys_prompt = f"You are a helpful assistant.\n\nKnown context:\n{context}"
```

## Short-term (Redis) vs long-term (pgvector)

- Short-term: use for within-session state, conversation history, temporary flags
- Long-term: use for facts that should persist across sessions (customer data, decisions made)
- Default `MemoryManager()` uses long-term pgvector — explicitly set `ATOM_MEMORY_BACKEND=redis` for short-term

## Pattern: recall before respond

```python
def handle_message(self, msg: Msg) -> Msg:
    # Always recall relevant context before calling the LLM
    memories = self.memory.recall(msg.content, top_k=5)
    context = "\n".join(m["content"] for m in memories)
    enriched_prompt = f"{context}\n\nUser: {msg.content}"
    return self.model(enriched_prompt)
```

## Rules

- NEVER import `psycopg2` or `redis` directly in agent code — use `MemoryManager`
- NEVER hardcode pgvector connection strings or Redis URLs in agent.py
- Memory is namespaced per agent automatically — no risk of cross-agent data leakage


# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-a2a/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-multi-agent/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

---
name: atom-multi-agent
description: Use when generating an agent that orchestrates multiple sub-agents or pipelines within the same pod. Covers MsgHub, sequential_pipeline, and correct inter-agent wiring using atom-sdk.
---

# ATOM Multi-Agent Orchestration

## Imports

```python
from agentscope.pipeline import MsgHub, sequential_pipeline
from agentscope.message import Msg
```

## Sequential pipeline (most common)

```python
# Wire two agents in sequence: output of agent1 becomes input of agent2
async def run_pipeline(user_input: str):
    msg = Msg(role="user", content=user_input)
    result = await sequential_pipeline([agent1, agent2, agent3], msg)
    return result
```

## MsgHub (shared message bus for parallel agents)

```python
async def run_parallel(user_input: str):
    msg = Msg(role="user", content=user_input)
    async with MsgHub([agent1, agent2]) as hub:
        await hub.broadcast(msg)
        responses = await hub.collect()
    return responses
```

## Rules

- Sub-agents within the same pod communicate via `sequential_pipeline` or `MsgHub` — no HTTP
- If an agent in a pipeline needs to call an agent in a **different pod**, use `a2a_call()` (see atom-a2a skill)
- Each sub-agent still uses `AtomChatModel` — no direct LLM calls
- All tool calls from sub-agents still go through `use_tool()` → GATE


# ─────────────────────────────────────────────────────────────────────────────
# atom-sdk/skills/atom-audit/SKILL.md
# ─────────────────────────────────────────────────────────────────────────────

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
