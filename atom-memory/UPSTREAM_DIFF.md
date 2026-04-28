# atom-memory — Upstream Diff

Upstream: https://github.com/modelscope/agentscope (memory/reme components)
Cloned on: 2026-04-28

---

## What the upstream is

`atom-memory/` is the full **agentscope** Python SDK — a general-purpose agent framework
with comprehensive memory implementations (Redis, pgvector, SQLAlchemy, Tablestore,
Mem0, ReMe). It is used as the upstream for `atom-sdk`.

The upstream library is left **unmodified** in `src/agentscope/`. All ATOM-specific
additions are in `memory/` — a separate Python package alongside the upstream library.

---

## ATOM-Specific Additions (SESSION-12)

All additions live in `memory/` — a standalone Python package that does not modify
the upstream agentscope code.

### New package: `memory/src/atom_memory/`

| File | Purpose |
|---|---|
| `backends/pgvector_backend.py` | Long-term semantic memory via Postgres + pgvector HNSW index |
| `backends/redis_backend.py` | Short-term key-value memory via Redis with configurable TTL |
| `manager.py` | `MemoryManager` — unified API routing to the two backends |

### New files

```
atom-memory/memory/
├── pyproject.toml              # atom-memory package (asyncpg, redis, pydantic)
├── src/atom_memory/
│   ├── __init__.py             # exports MemoryManager
│   ├── backends/
│   │   ├── __init__.py
│   │   ├── pgvector_backend.py
│   │   └── redis_backend.py
│   └── manager.py
└── tests/
    ├── conftest.py             # MockEmbeddingModel, make_embedding helpers
    └── test_memory.py          # 27 tests (25 unit + 2 integration)
```

### Memory architecture

```
MemoryManager
  ├─ Long-term (semantic)    → PgvectorBackend
  │   remember(content)         INSERT INTO memory_vectors
  │   recall(query, top_k)      SELECT ... ORDER BY embedding <=> $1::vector LIMIT $2
  │   forget(memory_id)         DELETE WHERE id=$1
  │   clear_long_term()         DELETE WHERE agent_id=$1
  │
  └─ Short-term (key-value)  → RedisBackend
      set(key, value, ttl)      SET atom:memory:{agent_id}:{key} ex={ttl}
      get(key)                  GET + JSON decode
      delete(key)               DEL
      clear_short_term()        SCAN + DEL all agent keys
```

### pgvector wire format

asyncpg does not have a built-in codec for the pgvector `vector` type. Embeddings
are passed as the string `"[v1,v2,...,vN]"` and cast in SQL (`$1::vector`). This
avoids any extra pgvector client-side dependency.

### agent_id scoping

Every query filters on `agent_id`. No agent can read or write another agent's
memories — enforced at the SQL level, not just application code.

Redis keys follow the pattern `atom:memory:{agent_id}:{key}` so `clear_short_term()`
only deletes that agent's keys.

---

## atom-sdk change (SESSION-12)

`atom-sdk/src/agentscope/model/_atom_model.py` — `AtomChatModel`:

- Added optional `memory_manager` parameter to `__init__`
- Overrode `__call__` to recall relevant memories and inject them into the system prompt

```python
model = AtomChatModel(
    model_name="gemini-2.5-flash",
    memory_manager=mem,  # MemoryManager instance
)
# Before every LLM call:
# 1. recall(last_user_message, top_k=5)
# 2. Prepend results to system message (or insert a system message)
# 3. Call parent OpenAIChatModel.__call__ with enriched messages
```

Recall failures are silently swallowed so a memory outage never blocks an LLM call.

---

## Running

```bash
# From atom-memory/memory/
uv run pytest tests/ -v                   # unit tests (no services)
uv run pytest tests/ -v -m integration   # + live Postgres + Redis
```

## Tests

| Group | Count | Requires |
|---|---|---|
| `_fmt_vector` | 2 | nothing |
| `PgvectorBackend` unit | 8 | AsyncMock pool |
| `RedisBackend` unit | 7 | fakeredis |
| `MemoryManager` unit | 4 | AsyncMock + fakeredis |
| `AtomChatModel` injection | 4 | mocks only |
| Integration — pgvector | 1 | live Postgres |
| Integration — Redis TTL | 1 | live Redis |
| **Total** | **27** | **27/27 passing** |
