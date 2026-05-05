---
name: atom-multi-agent
description: Orchestrate multiple agents using sequential_pipeline, fanout_pipeline, and MsgHub from agentscope.pipeline. Use for in-pod multi-agent coordination. For cross-pod calls use A2AAgent (atom-a2a skill).
---

# ATOM Multi-Agent Orchestration

## Imports

```python
from agentscope.pipeline import (
    sequential_pipeline,    # chain: output of N → input of N+1
    fanout_pipeline,        # broadcast: same input → all agents (parallel)
    MsgHub,                 # shared message bus
    SequentialPipeline,     # class version of sequential_pipeline
    FanoutPipeline,         # class version of fanout_pipeline
)
from agentscope.message import Msg
```

## Sequential pipeline — chain agents

```python
async def run_analysis(user_input: str):
    msg = Msg(name="user", content=user_input, role="user")

    # result: output of research_agent → input of analysis_agent → input of report_agent
    result = await sequential_pipeline(
        [research_agent, analysis_agent, report_agent],
        msg=msg,
    )
    return result.get_text_content()
```

Class version (reusable):
```python
pipeline = SequentialPipeline([research_agent, analysis_agent])
result = await pipeline(msg)
```

## Fanout pipeline — broadcast to all agents

```python
async def get_opinions(user_input: str):
    msg = Msg(name="user", content=user_input, role="user")

    # All agents receive the same message; results collected as list
    responses = await fanout_pipeline(
        [agent_a, agent_b, agent_c],
        msg=msg,
        enable_gather=True,   # True = concurrent; False = sequential
    )
    # responses: list[Msg]
    combined = "\n".join(r.get_text_content() for r in responses)
    return combined
```

## MsgHub — shared message bus

```python
async def run_debate(topic: str):
    msg = Msg(name="moderator", content=f"Debate topic: {topic}", role="user")

    async with MsgHub(
        participants=[agent_a, agent_b, agent_c],
        announcement=[msg],
        enable_auto_broadcast=True,
    ) as hub:
        # broadcast sends msg to all participants
        await hub.broadcast(Msg(name="moderator", content="Begin.", role="user"))
        # Each agent processes and replies; hub collects replies
```

## Building multiple agents with shared toolkit

```python
from agentscope.agent import ReActAgent
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit
from agentscope.memory import InMemoryMemory
from agentscope.formatter import GeminiChatFormatter

def make_agent(name: str, role: str, toolkit: Toolkit) -> ReActAgent:
    return ReActAgent(
        name=name,
        sys_prompt=f"You are {role}.",
        model=AtomChatModel(model_name="gemini-2.5-flash"),
        formatter=GeminiChatFormatter(),
        toolkit=toolkit,
        memory=InMemoryMemory(),
    )

shared_toolkit = Toolkit()
# register shared tools...

researcher = make_agent("Researcher", "a research specialist", shared_toolkit)
analyst   = make_agent("Analyst",    "a data analyst",         shared_toolkit)
reporter  = make_agent("Reporter",   "a report writer",        shared_toolkit)
```

## Rules

- Sub-agents within the same pod communicate via `sequential_pipeline` or `MsgHub` — no HTTP
- For cross-pod calls use `A2AAgent` (see `atom-a2a` skill) — never import or instantiate agents from other pods
- Each sub-agent must still use `AtomChatModel` — no direct LLM calls
- All tool calls from sub-agents go through GATE automatically via Toolkit
- `MsgHub` requires `async with` context manager
- `fanout_pipeline` with `enable_gather=True` runs agents concurrently
