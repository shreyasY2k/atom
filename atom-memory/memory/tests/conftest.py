"""Shared test fixtures for atom-memory tests."""

import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql://atom:changeme@localhost:5432/atom")

AGENT_ID = str(uuid.uuid4())
DIMS = 1536


def make_embedding(primary_dim: int, value: float = 1.0) -> list[float]:
    """
    Create a unit-ish test embedding that is strongest in one dimension.
    Two embeddings with the same primary_dim have cosine similarity 1;
    different primary dims have cosine similarity 0 (orthogonal).
    """
    v = [0.0] * DIMS
    v[primary_dim] = value
    return v


class MockEmbeddingModel:
    """Deterministic embedding model for tests.

    Accepts a list[str] and returns the pre-registered vector for each string.
    Unknown strings map to the zero vector.
    """

    def __init__(self) -> None:
        self._registry: dict[str, list[float]] = {}

    def register(self, text: str, embedding: list[float]) -> None:
        self._registry[text] = embedding

    async def __call__(self, texts: list[str]) -> object:
        embeddings = [self._registry.get(t, [0.0] * DIMS) for t in texts]

        class _Resp:
            pass

        resp = _Resp()
        resp.embeddings = embeddings
        return resp
