---
name: atom-memory
description: Working memory (InMemoryMemory) and long-term memory (Mem0LongTermMemory) for agents. Pass to ReActAgent constructor. Use add()/get_memory() for working memory. Covers correct classes and API — MemoryManager does not exist.
---

# ATOM Memory

## Working memory (short-term, within session)

```python
from agentscope.memory import InMemoryMemory

memory = InMemoryMemory()
```

Pass to `ReActAgent`:
```python
agent = ReActAgent(
    ...,
    memory=memory,          # short-term working memory
)
```

The agent automatically calls `memory.add()` and `memory.get_memory()` during the ReAct loop.

### Working memory API

```python
from agentscope.message import Msg

# Add a message to memory
await memory.add(
    Msg(name="system", content="Customer is VIP.", role="system"),
    marks="context",      # optional tag for later filtering
)

# Retrieve messages (filtered by mark)
messages = await memory.get_memory(
    mark="context",         # only messages tagged "context"
    prepend_summary=True,   # include compressed summary if available
)

# Get current size
count = await memory.size()

# Delete by mark
await memory.delete_by_mark("context")
```

## Long-term memory (across sessions)

Long-term memory persists facts and experiences beyond a single conversation.

```python
from agentscope.memory import Mem0LongTermMemory

long_term = Mem0LongTermMemory()   # requires: pip install mem0ai
```

Pass to `ReActAgent`:
```python
agent = ReActAgent(
    ...,
    memory=InMemoryMemory(),
    long_term_memory=long_term,
    long_term_memory_mode="both",   # "agent_control" | "static_control" | "both"
)
```

### Long-term memory API

```python
# Record facts from a conversation
await long_term.record(msgs=[msg1, msg2])

# Retrieve relevant memories (semantic search)
context = await long_term.retrieve(
    msg=Msg(name="user", content="customer credit limit", role="user"),
    limit=5,
)
```

## Other memory backends

| Class | Backend | Use case |
|---|---|---|
| `InMemoryMemory` | Python list | Default — fast, single process |
| `RedisMemory` | Redis | Multi-process / distributed |
| `AsyncSQLAlchemyMemory` | SQL DB | Persistent across restarts |
| `Mem0LongTermMemory` | mem0.ai | Semantic long-term recall |
| `ReMePersonalLongTermMemory` | reme-ai | Personal preferences |
| `ReMeTaskLongTermMemory` | reme-ai | Task experience |

## Correct pattern for memory-aware agents

```python
from agentscope.agent import ReActAgent
from agentscope.model import AtomChatModel
from agentscope.memory import InMemoryMemory
from agentscope.formatter import GeminiChatFormatter

memory = InMemoryMemory()

# Pre-load context before agent replies
await memory.add(
    Msg(name="system", content="Customer CUST-001 has credit limit $50,000.", role="system"),
    marks="customer_context",
)

agent = ReActAgent(
    name="credit-agent",
    sys_prompt="You are a credit analyst.",
    model=AtomChatModel(model_name="gemini-2.5-flash"),
    formatter=GeminiChatFormatter(),
    memory=memory,
)
```

## What NOT to generate

- NEVER: `from agentscope.hitl import MemoryManager` — `MemoryManager` does not exist
- NEVER: `memory.remember(...)` or `memory.recall(...)` — methods are `add()` and `get_memory()`
- NEVER: `import psycopg2` or `import redis` directly — use the memory backend classes
- NEVER: pass `memory_manager=memory` to `AtomChatModel` unless it is a `MemoryManager` from the model module
