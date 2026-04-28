# -*- coding: utf-8 -*-
"""
The embedding module — atom-sdk fork.

Only AtomTextEmbedding is exported. All provider-specific embeddings have
been removed; embedding calls must flow through GATE. See UPSTREAM_DIFF.md.
"""

from ._embedding_base import EmbeddingModelBase
from ._embedding_usage import EmbeddingUsage
from ._embedding_response import EmbeddingResponse
from ._cache_base import EmbeddingCacheBase
from ._file_cache import FileEmbeddingCache
from ._atom_embedding import AtomTextEmbedding

__all__ = [
    "EmbeddingModelBase",
    "EmbeddingUsage",
    "EmbeddingResponse",
    "EmbeddingCacheBase",
    "FileEmbeddingCache",
    "AtomTextEmbedding",
]
