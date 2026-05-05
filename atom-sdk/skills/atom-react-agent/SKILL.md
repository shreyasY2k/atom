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
