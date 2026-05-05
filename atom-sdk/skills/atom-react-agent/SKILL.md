---
name: atom-react-agent
description: Correct ReActAgent construction with required formatter, AtomChatModel, Toolkit, and memory. Use this for any generated agent.py. The formatter argument is required and must match the model provider.
---

# ATOM ReAct Agent

## Required imports

```python
from agentscope.agent import ReActAgent
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit
from agentscope.memory import InMemoryMemory
from agentscope.message import Msg
# Pick the formatter that matches the model provider:
from agentscope.formatter import (
    GeminiChatFormatter,       # for gemini-* models
    OpenAIChatFormatter,       # for gpt-* models
    AnthropicChatFormatter,    # for claude-* models
)
```

## `ReActAgent.__init__` signature (COMPLETE)

```python
ReActAgent(
    name: str,                         # REQUIRED
    sys_prompt: str,                   # REQUIRED
    model: ChatModelBase,              # REQUIRED — use AtomChatModel
    formatter: FormatterBase,          # REQUIRED — must match model provider
    toolkit: Toolkit | None = None,    # optional but always provide
    memory: MemoryBase | None = None,  # optional — use InMemoryMemory
    long_term_memory: LongTermMemoryBase | None = None,
    long_term_memory_mode: str = "both",
    enable_meta_tool: bool = False,
    parallel_tool_calls: bool = False,
    max_iters: int = 10,
)
```

**`formatter` is REQUIRED and positional — omitting it raises `TypeError`.**

## Choosing the right formatter

| Model name starts with | Formatter class |
|---|---|
| `gemini-` | `GeminiChatFormatter()` |
| `gpt-` | `OpenAIChatFormatter()` |
| `claude-` | `AnthropicChatFormatter()` |

## Minimal working agent

```python
import os
import asyncio
from agentscope import init
from agentscope.agent import ReActAgent
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit
from agentscope.memory import InMemoryMemory
from agentscope.message import Msg
from agentscope.formatter import GeminiChatFormatter  # change per model

def main():
    init(studio_url=os.environ.get("ATOM_GATE_URL", "http://localhost:8080"))

    model_name = os.environ.get("ATOM_MODEL", "gemini-2.5-flash")
    toolkit = Toolkit()
    # register tools here: toolkit.register_tool_function(my_func)

    agent = ReActAgent(
        name=os.environ.get("ATOM_AGENT_NAME", "agent"),
        sys_prompt="You are a helpful assistant.",
        model=AtomChatModel(model_name=model_name),
        formatter=GeminiChatFormatter(),   # REQUIRED
        toolkit=toolkit,
        memory=InMemoryMemory(),
        max_iters=10,
    )
    return agent

if __name__ == "__main__":
    agent = main()
    response = asyncio.run(agent.reply(Msg(name="user", content="Hello!", role="user")))
    print(response.get_text_content())
```

## Registering tools

Tools are Python functions registered into the Toolkit **before** building the agent.
The ReAct loop calls them automatically — you never call them manually.

```python
async def lookup_customer(customer_id: str) -> str:
    """Look up customer record. Args: customer_id (str). Returns JSON string."""
    # implementation here — all HTTP goes through GATE automatically
    ...

toolkit = Toolkit()
toolkit.register_tool_function(
    lookup_customer,
    group_name="basic",   # "basic" is always active
)
```

## Calling the agent

```python
from agentscope.message import Msg

msg = Msg(name="user", content="Check customer C-123", role="user")
response = await agent.reply(msg)
text = response.get_text_content()
```

## What NOT to generate

- NEVER: `from agentscope.agents import ...` — module is `agentscope.agent` (singular)
- NEVER: `from agentscope.models import ...` — module is `agentscope.model` (singular)
- NEVER: `agent.use_tool(...)` — tools are called by the ReAct loop automatically
- NEVER: omit `formatter=` — `ReActAgent` raises `TypeError` without it
- NEVER: `AtomChatModel(api_key=..., base_url=...)` — credentials come from env vars only
