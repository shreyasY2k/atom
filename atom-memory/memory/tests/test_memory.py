"""
Tests for atom-memory backends and MemoryManager.

Unit tests use AsyncMock / fakeredis — no real services needed.
Integration tests (marked @pytest.mark.integration) hit the live
Postgres and Redis instances; skip them if services are unavailable.
"""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from atom_memory.backends.pgvector_backend import PgvectorBackend, _fmt_vector
from atom_memory.backends.redis_backend import RedisBackend
from atom_memory.manager import MemoryManager
from tests.conftest import AGENT_ID, DIMS, MockEmbeddingModel, make_embedding


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_pool(fetchrow_rv=None, fetch_rv=None, execute_rv=None, fetchval_rv=None):
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=fetchrow_rv)
    conn.fetch = AsyncMock(return_value=fetch_rv or [])
    conn.execute = AsyncMock(return_value=execute_rv or "DELETE 0")
    conn.fetchval = AsyncMock(return_value=fetchval_rv or 0)
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=None)

    pool = MagicMock()
    pool.acquire = MagicMock(return_value=conn)
    return pool, conn


# ── _fmt_vector ───────────────────────────────────────────────────────────────


def test_fmt_vector_format():
    v = [0.1, 0.2, 0.3]
    assert _fmt_vector(v) == "[0.1,0.2,0.3]"


def test_fmt_vector_full_dims():
    v = [0.0] * DIMS
    s = _fmt_vector(v)
    assert s.startswith("[")
    assert s.endswith("]")
    assert s.count(",") == DIMS - 1


# ── PgvectorBackend unit tests ────────────────────────────────────────────────


async def test_pgvector_store_inserts_correct_row():
    pool, conn = _make_pool(fetchrow_rv={"id": str(uuid.uuid4())})
    backend = PgvectorBackend(AGENT_ID, pool)
    content = "Customer prefers email"
    embedding = make_embedding(0)
    meta = {"source": "conversation"}

    await backend.store(content, embedding, meta)

    conn.fetchrow.assert_awaited_once()
    call_args = conn.fetchrow.call_args
    sql = call_args[0][0]
    assert "INSERT INTO memory_vectors" in sql
    assert "::vector" in sql
    assert "::jsonb" in sql

    # Second positional arg should be agent_id
    assert call_args[0][1] == AGENT_ID
    # Third arg is the content
    assert call_args[0][2] == content
    # Fourth arg is the vector string
    assert call_args[0][3].startswith("[")
    # Fifth arg is JSON metadata
    assert json.loads(call_args[0][4]) == meta


async def test_pgvector_store_null_metadata():
    pool, conn = _make_pool(fetchrow_rv={"id": str(uuid.uuid4())})
    backend = PgvectorBackend(AGENT_ID, pool)
    await backend.store("no metadata", make_embedding(0), None)
    # metadata arg should be None
    assert conn.fetchrow.call_args[0][4] is None


async def test_pgvector_search_uses_cosine_operator():
    pool, conn = _make_pool(
        fetch_rv=[
            {
                "id": "aaa",
                "content": "row1",
                "metadata": None,
                "created_at": None,
                "similarity": 0.9,
            },
            {
                "id": "bbb",
                "content": "row2",
                "metadata": None,
                "created_at": None,
                "similarity": 0.7,
            },
        ]
    )
    backend = PgvectorBackend(AGENT_ID, pool)
    results = await backend.search(make_embedding(0), top_k=2)

    conn.fetch.assert_awaited_once()
    sql = conn.fetch.call_args[0][0]
    assert "<=>" in sql  # cosine distance operator
    assert "ORDER BY" in sql
    assert "LIMIT" in sql
    assert conn.fetch.call_args[0][2] == AGENT_ID  # scoped to agent

    assert len(results) == 2
    assert results[0]["content"] == "row1"


async def test_pgvector_search_top_k_param():
    pool, conn = _make_pool(fetch_rv=[])
    backend = PgvectorBackend(AGENT_ID, pool)
    await backend.search(make_embedding(0), top_k=7)
    # top_k should be the last SQL parameter
    assert conn.fetch.call_args[0][-1] == 7


async def test_pgvector_delete_returns_true_when_row_deleted():
    pool, conn = _make_pool(execute_rv="DELETE 1")
    backend = PgvectorBackend(AGENT_ID, pool)
    assert await backend.delete(str(uuid.uuid4())) is True


async def test_pgvector_delete_returns_false_when_not_found():
    pool, conn = _make_pool(execute_rv="DELETE 0")
    backend = PgvectorBackend(AGENT_ID, pool)
    assert await backend.delete(str(uuid.uuid4())) is False


async def test_pgvector_clear_returns_count():
    pool, conn = _make_pool(execute_rv="DELETE 5")
    backend = PgvectorBackend(AGENT_ID, pool)
    count = await backend.clear()
    assert count == 5
    sql = conn.execute.call_args[0][0]
    assert "DELETE FROM memory_vectors" in sql
    assert conn.execute.call_args[0][1] == AGENT_ID


async def test_pgvector_count():
    pool, conn = _make_pool(fetchval_rv=42)
    backend = PgvectorBackend(AGENT_ID, pool)
    assert await backend.count() == 42


# ── RedisBackend unit tests ───────────────────────────────────────────────────


async def test_redis_store_and_retrieve_dict():
    """Test round-trip of a dict value through fake Redis."""
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    backend = RedisBackend(AGENT_ID, r, default_ttl=60)

    value = {"loan_amount": 50000, "status": "pending"}
    await backend.store("loan", value)
    result = await backend.retrieve("loan")

    assert result == value


async def test_redis_store_and_retrieve_string():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    backend = RedisBackend(AGENT_ID, r, default_ttl=60)

    await backend.store("greeting", "hello world")
    result = await backend.retrieve("greeting")
    assert result == "hello world"


async def test_redis_retrieve_missing_key_returns_none():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    backend = RedisBackend(AGENT_ID, r)
    assert await backend.retrieve("nonexistent") is None


async def test_redis_key_scoping():
    """Keys from different agents must not collide."""
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    a1 = RedisBackend("agent-1", r)
    a2 = RedisBackend("agent-2", r)

    await a1.store("k", "agent1-value")
    await a2.store("k", "agent2-value")

    assert await a1.retrieve("k") == "agent1-value"
    assert await a2.retrieve("k") == "agent2-value"


async def test_redis_clear_removes_only_agent_keys():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    a1 = RedisBackend("agent-1", r)
    a2 = RedisBackend("agent-2", r)

    await a1.store("k1", "v1")
    await a1.store("k2", "v2")
    await a2.store("k1", "v1")

    deleted = await a1.clear()
    assert deleted == 2
    assert await a1.retrieve("k1") is None
    assert await a1.retrieve("k2") is None
    assert await a2.retrieve("k1") == "v1"  # untouched


async def test_redis_ttl_override():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    backend = RedisBackend(AGENT_ID, r, default_ttl=3600)

    await backend.store("k", "v", ttl=7200)
    remaining = await backend.ttl("k")
    assert 7190 <= remaining <= 7200


async def test_redis_delete():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    backend = RedisBackend(AGENT_ID, r)
    await backend.store("k", "v")
    assert await backend.delete("k") is True
    assert await backend.retrieve("k") is None
    assert await backend.delete("k") is False


# ── MemoryManager unit tests ──────────────────────────────────────────────────


async def test_manager_remember_calls_embedding_then_store():
    pool, conn = _make_pool(fetchrow_rv={"id": str(uuid.uuid4())})
    embedding_model = MockEmbeddingModel()
    text = "The customer is risk-averse"
    embedding_model.register(text, make_embedding(0))

    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    mem = MemoryManager.from_config(
        agent_id=AGENT_ID,
        db_pool=pool,
        redis=r,
        embedding_model=embedding_model,
        short_term_ttl_s=60,
    )

    memory_id = await mem.remember(text, metadata={"type": "preference"})

    # embedding model was called
    conn.fetchrow.assert_awaited_once()
    # returned a string UUID
    assert isinstance(memory_id, str)


async def test_manager_recall_calls_embedding_then_search():
    similarity_results = [
        {
            "id": "x",
            "content": "customer is risk-averse",
            "metadata": None,
            "created_at": None,
            "similarity": 0.95,
        },
        {
            "id": "y",
            "content": "prefers email contact",
            "metadata": None,
            "created_at": None,
            "similarity": 0.70,
        },
    ]
    pool, conn = _make_pool(fetch_rv=similarity_results)
    embedding_model = MockEmbeddingModel()
    query = "What are the customer preferences?"
    embedding_model.register(query, make_embedding(0))

    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    r = fakeredis.FakeRedis()
    mem = MemoryManager.from_config(
        agent_id=AGENT_ID, db_pool=pool, redis=r, embedding_model=embedding_model
    )

    results = await mem.recall(query, top_k=2)
    assert len(results) == 2
    assert results[0]["similarity"] > results[1]["similarity"]


async def test_manager_set_and_get():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    pool, _ = _make_pool()
    r = fakeredis.FakeRedis()
    embedding_model = MockEmbeddingModel()
    mem = MemoryManager.from_config(AGENT_ID, pool, r, embedding_model)

    await mem.set("last_action", {"type": "loan_check", "amount": 25000})
    result = await mem.get("last_action")
    assert result == {"type": "loan_check", "amount": 25000}


async def test_manager_get_missing_key_returns_none():
    try:
        import fakeredis.aioredis as fakeredis
    except ImportError:
        pytest.skip("fakeredis not installed")

    pool, _ = _make_pool()
    r = fakeredis.FakeRedis()
    mem = MemoryManager.from_config(AGENT_ID, pool, r, MockEmbeddingModel())
    assert await mem.get("no_such_key") is None


# ── Integration test: store 10 memories, recall top 3 ────────────────────────


@pytest.mark.integration
async def test_store_10_recall_top3_ordering():
    """
    Full integration: store 10 memories with known embeddings in live Postgres,
    issue a query whose embedding is closest to memories 0,1,2 (in that order),
    and verify the recall order matches.

    Skips automatically if live Postgres isn't reachable.
    """
    import asyncpg
    import math

    try:
        pool = await asyncpg.create_pool(
            "postgresql://atom:changeme@localhost:5432/atom",
            min_size=1,
            max_size=2,
        )
    except Exception:
        pytest.skip("Postgres not reachable")

    # Create a temporary domain + agent so the FK constraint is satisfied.
    # Both are cleaned up in the finally block.
    domain_id = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    test_agent_id = str(uuid.uuid4())

    def normalise(v):
        mag = math.sqrt(sum(x * x for x in v))
        return [x / mag if mag else x for x in v]

    memories_text = [f"memory-{i}" for i in range(10)]
    # memory-i is strongest in dimension i; similarity to dim-0 query decreases
    memories_embeddings = [
        normalise(make_embedding(i, value=1.0 / (i + 1))) for i in range(10)
    ]
    query_embedding = normalise(make_embedding(0))

    try:
        async with pool.acquire() as conn:
            # Minimal seed: user → domain → agent (no litellm provisioning)
            await conn.execute(
                "INSERT INTO users (id, email, password_hash, role) "
                "VALUES ($1, $2, 'x', 'developer')",
                user_id,
                f"test-{user_id}@atom.test",
            )
            await conn.execute(
                "INSERT INTO domains (id, name, owner_id) VALUES ($1, $2, $3)",
                domain_id,
                f"test-domain-{domain_id[:8]}",
                user_id,
            )
            await conn.execute(
                "INSERT INTO agents (id, domain_id, owner_id, name) "
                "VALUES ($1, $2, $3, $4)",
                test_agent_id,
                domain_id,
                user_id,
                "memory-test-agent",
            )

        backend = PgvectorBackend(test_agent_id, pool)

        for text, emb in zip(memories_text, memories_embeddings):
            await backend.store(text, emb)

        assert await backend.count() == 10

        results = await backend.search(query_embedding, top_k=3)
        assert len(results) == 3

        sims = [r["similarity"] for r in results]
        assert sims == sorted(
            sims, reverse=True
        ), f"Results not ordered by similarity: {sims}"
        assert (
            results[0]["content"] == "memory-0"
        ), f"Expected 'memory-0' first, got '{results[0]['content']}'"

    finally:
        async with pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM memory_vectors WHERE agent_id=$1", test_agent_id
            )
            await conn.execute("DELETE FROM agents WHERE id=$1", test_agent_id)
            await conn.execute("DELETE FROM domains WHERE id=$1", domain_id)
            await conn.execute("DELETE FROM users WHERE id=$1", user_id)
        await pool.close()


@pytest.mark.integration
async def test_redis_integration_ttl():
    """Integration: verify Redis TTL via the live container."""
    try:
        import redis.asyncio as aioredis

        r = aioredis.from_url("redis://:changeme@localhost:6379")
        await r.ping()
    except Exception:
        pytest.skip("Redis not reachable")

    test_agent_id = str(uuid.uuid4())
    backend = RedisBackend(test_agent_id, r, default_ttl=10)

    try:
        await backend.store("probe", "value", ttl=30)
        assert await backend.exists("probe")
        remaining = await backend.ttl("probe")
        assert 20 <= remaining <= 30
        assert await backend.retrieve("probe") == "value"
    finally:
        await backend.clear()
        await r.aclose()


# ── AtomChatModel memory injection test ──────────────────────────────────────


async def test_atom_model_injects_memories_into_system_prompt():
    """
    AtomChatModel with a memory_manager recalls context and prepends it
    to the system message before the parent __call__ fires.
    """
    import os

    os.environ.setdefault("ATOM_GATE_URL", "http://gate.test")
    os.environ.setdefault("ATOM_DOMAIN_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_JWT", "test-jwt")

    # Build a mock MemoryManager that returns two memories
    mock_mem = AsyncMock()
    mock_mem.recall = AsyncMock(
        return_value=[
            {"content": "Customer John prefers email"},
            {"content": "John is a premium account holder"},
        ]
    )

    # Patch OpenAIChatModel.__init__ and __call__ to avoid real API calls
    with (
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__init__",
            return_value=None,
        ),
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__call__",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_parent_call,
    ):
        from agentscope.model._atom_model import AtomChatModel

        model = AtomChatModel.__new__(AtomChatModel)
        model.memory_manager = mock_mem
        model.model_name = "gemini-2.5-flash"
        model.stream = False

        original_messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": "What does John prefer?"},
        ]

        await model.__call__(messages=list(original_messages))

    # parent __call__ must have been called
    mock_parent_call.assert_awaited_once()
    actual_messages = mock_parent_call.call_args.kwargs["messages"]

    # System message must contain the injected memories
    sys_msg = next(m for m in actual_messages if m["role"] == "system")
    assert "Customer John prefers email" in sys_msg["content"]
    assert "John is a premium account holder" in sys_msg["content"]


async def test_atom_model_no_memories_passes_messages_unchanged():
    """When recall returns empty, messages must pass through unmodified."""
    import os

    os.environ.setdefault("ATOM_GATE_URL", "http://gate.test")
    os.environ.setdefault("ATOM_DOMAIN_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_JWT", "test-jwt")

    mock_mem = AsyncMock()
    mock_mem.recall = AsyncMock(return_value=[])

    with (
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__init__",
            return_value=None,
        ),
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__call__",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_parent_call,
    ):
        from agentscope.model._atom_model import AtomChatModel

        model = AtomChatModel.__new__(AtomChatModel)
        model.memory_manager = mock_mem
        model.model_name = "gemini-2.5-flash"
        model.stream = False

        original_messages = [{"role": "user", "content": "Hello"}]
        await model.__call__(messages=list(original_messages))

    actual_messages = mock_parent_call.call_args.kwargs["messages"]
    assert actual_messages == original_messages


async def test_atom_model_no_memory_manager_unchanged():
    """Without a memory_manager, messages pass through completely unchanged."""
    import os

    os.environ.setdefault("ATOM_GATE_URL", "http://gate.test")
    os.environ.setdefault("ATOM_DOMAIN_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_JWT", "test-jwt")

    with (
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__init__",
            return_value=None,
        ),
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__call__",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_parent_call,
    ):
        from agentscope.model._atom_model import AtomChatModel

        model = AtomChatModel.__new__(AtomChatModel)
        model.memory_manager = None
        model.model_name = "gemini-2.5-flash"
        model.stream = False

        messages = [{"role": "user", "content": "Hi"}]
        await model.__call__(messages=list(messages))

    assert mock_parent_call.call_args.kwargs["messages"] == messages


async def test_atom_model_recall_failure_does_not_block_call():
    """Memory recall failure is silently swallowed — the LLM call proceeds."""
    import os

    os.environ.setdefault("ATOM_GATE_URL", "http://gate.test")
    os.environ.setdefault("ATOM_DOMAIN_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_ID", str(uuid.uuid4()))
    os.environ.setdefault("ATOM_AGENT_JWT", "test-jwt")

    mock_mem = AsyncMock()
    mock_mem.recall = AsyncMock(side_effect=RuntimeError("DB is down"))

    with (
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__init__",
            return_value=None,
        ),
        patch(
            "agentscope.model._openai_model.OpenAIChatModel.__call__",
            new_callable=AsyncMock,
            return_value=MagicMock(),
        ) as mock_parent_call,
    ):
        from agentscope.model._atom_model import AtomChatModel

        model = AtomChatModel.__new__(AtomChatModel)
        model.memory_manager = mock_mem
        model.model_name = "gemini-2.5-flash"
        model.stream = False

        await model.__call__(messages=[{"role": "user", "content": "test"}])

    # Parent call still fires despite the recall exception
    mock_parent_call.assert_awaited_once()
