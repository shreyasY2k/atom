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
