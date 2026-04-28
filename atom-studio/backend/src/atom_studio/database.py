from contextlib import asynccontextmanager
from typing import AsyncGenerator

import asyncpg

from .config import get_settings

_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        get_settings().database_url,
        min_size=2,
        max_size=10,
    )


async def get_pool() -> asyncpg.Pool:
    if _pool is None:
        await init_pool()
    return _pool


@asynccontextmanager
async def get_conn() -> AsyncGenerator[asyncpg.Connection, None]:
    pool = await get_pool()
    async with pool.acquire() as conn:
        yield conn
