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
