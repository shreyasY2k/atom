"""
pgvector_backend.py — Long-term agent memory via PostgreSQL + pgvector.

All rows are scoped to agent_id. The embedding column uses the HNSW index
defined in migration 000007 for fast approximate cosine-similarity search.

pgvector wire format: vectors are passed as the string "[v1,v2,...,vN]"
and cast to the vector type in SQL. asyncpg returns them as strings too,
so they are parsed on read.
"""

import json
import logging
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

# Maximum embedding dimensions stored — matches the migration's vector(1536)
_MAX_DIMS = 1536


def _fmt_vector(embedding: list[float]) -> str:
    """Format a list of floats as a pgvector literal: '[v1,v2,...,vN]'."""
    return "[" + ",".join(str(v) for v in embedding) + "]"


def _parse_vector(raw: str | None) -> list[float] | None:
    """Parse a pgvector string back to a list of floats."""
    if raw is None:
        return None
    return [float(v) for v in raw.strip("[]").split(",")]


class PgvectorBackend:
    """Long-term memory backend backed by Postgres + pgvector."""

    def __init__(self, agent_id: str, pool: asyncpg.Pool) -> None:
        self.agent_id = agent_id
        self.pool = pool

    async def store(
        self,
        content: str,
        embedding: list[float],
        metadata: dict[str, Any] | None = None,
    ) -> str:
        """Insert a new memory vector. Returns the UUID of the new row."""
        emb_str = _fmt_vector(embedding)
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO memory_vectors (agent_id, content, embedding, metadata)
                VALUES ($1, $2, $3::vector, $4::jsonb)
                RETURNING id
                """,
                self.agent_id,
                content,
                emb_str,
                json.dumps(metadata) if metadata is not None else None,
            )
        return str(row["id"])

    async def search(
        self,
        query_embedding: list[float],
        top_k: int = 5,
    ) -> list[dict]:
        """
        Return the top_k most semantically similar memories for this agent.

        Results are ordered by cosine similarity (highest first).
        Each dict has: id, content, metadata, created_at, similarity (float).
        """
        emb_str = _fmt_vector(query_embedding)
        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT
                    id::text,
                    content,
                    metadata,
                    created_at,
                    1 - (embedding <=> $1::vector) AS similarity
                FROM memory_vectors
                WHERE agent_id = $2
                ORDER BY embedding <=> $1::vector
                LIMIT $3
                """,
                emb_str,
                self.agent_id,
                top_k,
            )
        results = []
        for row in rows:
            r = dict(row)
            if r.get("metadata") and isinstance(r["metadata"], str):
                r["metadata"] = json.loads(r["metadata"])
            results.append(r)
        return results

    async def delete(self, memory_id: str) -> bool:
        """Delete a specific memory. Returns True if a row was deleted."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM memory_vectors WHERE id=$1 AND agent_id=$2",
                memory_id,
                self.agent_id,
            )
        return result != "DELETE 0"

    async def clear(self) -> int:
        """Delete all memories for this agent. Returns the count deleted."""
        async with self.pool.acquire() as conn:
            result = await conn.execute(
                "DELETE FROM memory_vectors WHERE agent_id=$1",
                self.agent_id,
            )
        # asyncpg returns "DELETE N"
        return int(result.split()[-1])

    async def count(self) -> int:
        """Return the number of stored memory vectors for this agent."""
        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                "SELECT count(*) FROM memory_vectors WHERE agent_id=$1",
                self.agent_id,
            )
