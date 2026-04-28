"""
manager.py — MemoryManager: unified interface for agent memory.

Routes long-term (semantic) operations to pgvector and short-term
(key/value with TTL) operations to Redis.

Usage inside an agent pod:
    import asyncpg
    import redis.asyncio as aioredis
    from agentscope.embedding import AtomTextEmbedding
    from atom_memory import MemoryManager
    from atom_memory.backends import PgvectorBackend, RedisBackend

    db_pool = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    redis = aioredis.from_url(os.environ["REDIS_URL"])
    embedding = AtomTextEmbedding(model_name="text-embedding-3-small")

    mem = MemoryManager.from_env(
        agent_id=os.environ["ATOM_AGENT_ID"],
        db_pool=db_pool,
        redis=redis,
        embedding_model=embedding,
    )

    # Long-term semantic memory
    await mem.remember("Customer John prefers email contact", metadata={"type": "preference"})
    results = await mem.recall("How does John prefer to be contacted?", top_k=3)

    # Short-term key-value memory
    await mem.set("last_loan_amount", 50000)
    amount = await mem.get("last_loan_amount")
"""

from __future__ import annotations

import logging
from typing import Any

from .backends.pgvector_backend import PgvectorBackend
from .backends.redis_backend import RedisBackend

logger = logging.getLogger(__name__)


class MemoryManager:
    """
    Unified agent memory: semantic long-term (pgvector) + TTL short-term (Redis).

    All operations are automatically scoped to `agent_id`.
    """

    def __init__(
        self,
        agent_id: str,
        pgvector: PgvectorBackend,
        redis: RedisBackend,
        embedding_model: Any,  # EmbeddingModelBase — avoid hard import
    ) -> None:
        self.agent_id = agent_id
        self._pgvector = pgvector
        self._redis = redis
        self._embedding_model = embedding_model

    # ── Long-term (semantic) memory ────────────────────────────────────────────

    async def remember(
        self,
        content: str,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """
        Store a memory in pgvector.

        Embeds `content` via the agent's embedding model (GATE → atom-llm),
        then inserts the vector + text into `memory_vectors`.

        Returns the UUID of the new memory row.
        """
        embedding_resp = await self._embedding_model([content])
        vector: list[float] = embedding_resp.embeddings[0]
        return await self._pgvector.store(content, vector, metadata)

    async def recall(
        self,
        query: str,
        top_k: int = 5,
    ) -> list[dict]:
        """
        Retrieve the top_k most semantically relevant memories.

        Embeds `query`, runs a cosine-distance search via the HNSW index,
        and returns results ordered by descending similarity.

        Each result dict: {id, content, metadata, created_at, similarity}.
        """
        embedding_resp = await self._embedding_model([query])
        vector: list[float] = embedding_resp.embeddings[0]
        return await self._pgvector.search(vector, top_k)

    async def forget(self, memory_id: str) -> bool:
        """Delete a specific long-term memory. Returns True if it existed."""
        return await self._pgvector.delete(memory_id)

    async def clear_long_term(self) -> int:
        """Erase all long-term memories for this agent."""
        return await self._pgvector.clear()

    # ── Short-term (key-value) memory ──────────────────────────────────────────

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int | None = None,
    ) -> None:
        """Store a value in Redis with an optional TTL override."""
        await self._redis.store(key, value, ttl)

    async def get(self, key: str) -> Any | None:
        """Retrieve a value from Redis; returns None if absent or expired."""
        return await self._redis.retrieve(key)

    async def delete(self, key: str) -> bool:
        """Delete a short-term key. Returns True if it existed."""
        return await self._redis.delete(key)

    async def clear_short_term(self) -> int:
        """Erase all short-term memory keys for this agent."""
        return await self._redis.clear()

    # ── Factory ────────────────────────────────────────────────────────────────

    @classmethod
    def from_config(
        cls,
        agent_id: str,
        db_pool: Any,
        redis: Any,
        embedding_model: Any,
        short_term_ttl_s: int = 3600,
    ) -> "MemoryManager":
        """
        Construct a MemoryManager from pre-connected pool/client objects.

        Args:
            agent_id: The ATOM agent UUID (from ATOM_AGENT_ID env var).
            db_pool: asyncpg.Pool connected to ATOM Postgres.
            redis: redis.asyncio.Redis client.
            embedding_model: AtomTextEmbedding instance (or any EmbeddingModelBase).
            short_term_ttl_s: Default Redis TTL in seconds (default 1 hour).
        """
        return cls(
            agent_id=agent_id,
            pgvector=PgvectorBackend(agent_id, db_pool),
            redis=RedisBackend(agent_id, redis, default_ttl=short_term_ttl_s),
            embedding_model=embedding_model,
        )
