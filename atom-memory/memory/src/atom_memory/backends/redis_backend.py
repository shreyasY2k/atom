"""
redis_backend.py — Short-term agent memory via Redis with TTL.

Key pattern: atom:memory:{agent_id}:{key}
Values are JSON-encoded so dicts/lists survive the round-trip.
"""

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

_PREFIX = "atom:memory"


class RedisBackend:
    """Short-term memory backend backed by Redis with per-key TTL."""

    def __init__(self, agent_id: str, redis, default_ttl: int = 3600) -> None:
        """
        Args:
            agent_id: Scopes all keys to this agent.
            redis: An async redis.asyncio.Redis client instance.
            default_ttl: Seconds before a key expires (default 1 hour).
        """
        self.agent_id = agent_id
        self.redis = redis
        self.default_ttl = default_ttl

    def _key(self, key: str) -> str:
        return f"{_PREFIX}:{self.agent_id}:{key}"

    async def store(
        self,
        key: str,
        value: Any,
        ttl: int | None = None,
    ) -> None:
        """
        Store a value under `key` with an optional TTL.
        Falls back to `default_ttl` if ttl is not specified.
        """
        raw = json.dumps(value)
        effective_ttl = ttl if ttl is not None else self.default_ttl
        await self.redis.set(self._key(key), raw, ex=effective_ttl)

    async def retrieve(self, key: str) -> Any | None:
        """
        Return the value stored at `key`, or None if missing/expired.
        Dicts and lists are deserialized from JSON; plain strings are
        returned as-is.
        """
        raw = await self.redis.get(self._key(key))
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode()
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            return raw

    async def delete(self, key: str) -> bool:
        """Delete a key. Returns True if the key existed."""
        deleted = await self.redis.delete(self._key(key))
        return bool(deleted)

    async def clear(self) -> int:
        """
        Delete all short-term memory keys for this agent.
        Returns the count of keys deleted.
        """
        pattern = f"{_PREFIX}:{self.agent_id}:*"
        keys: list[bytes] = []
        async for key in self.redis.scan_iter(pattern):
            keys.append(key)
        if not keys:
            return 0
        return await self.redis.delete(*keys)

    async def exists(self, key: str) -> bool:
        """Return True if `key` exists and hasn't expired."""
        return bool(await self.redis.exists(self._key(key)))

    async def ttl(self, key: str) -> int:
        """Return the remaining TTL in seconds, or -2 if the key doesn't exist."""
        return await self.redis.ttl(self._key(key))
