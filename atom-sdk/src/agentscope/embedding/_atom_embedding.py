# -*- coding: utf-8 -*-
"""
_atom_embedding.py — ATOM embedding model for agentscope.

Routes embedding calls through GATE → atom-llm, identical pattern to
AtomChatModel. Used by agentscope RAG pipelines and atom-memory.
"""

import os
from typing import Any

from ._openai_embedding import OpenAITextEmbedding
from ._cache_base import EmbeddingCacheBase


def _gate_base_url() -> str:
    gate_url = os.environ["ATOM_GATE_URL"].rstrip("/")
    domain_id = os.environ["ATOM_DOMAIN_ID"]
    agent_id = os.environ["ATOM_AGENT_ID"]
    return f"{gate_url}/domain/{domain_id}/agent/{agent_id}/v1"


def _agent_jwt() -> str:
    jwt = os.environ.get("ATOM_AGENT_JWT")
    if not jwt:
        raise EnvironmentError(
            "ATOM_AGENT_JWT is not set. "
            "This var is injected by atom-runtime when the agent pod starts.",
        )
    return jwt


class AtomTextEmbedding(OpenAITextEmbedding):
    """
    Embedding model that routes through GATE → atom-llm.

    base_url and api_key are always sourced from ATOM env vars.
    """

    def __init__(
        self,
        model_name: str,
        dimensions: int = 1536,
        embedding_cache: EmbeddingCacheBase | None = None,
        **_ignored: Any,  # silently ignore api_key / base_url
    ) -> None:
        """Initialize AtomTextEmbedding.

        Args:
            model_name (`str`):
                The embedding model name (e.g. ``"text-embedding-3-small"``).
            dimensions (`int`, default ``1536``):
                Output vector dimensions.
            embedding_cache (`EmbeddingCacheBase | None`, optional):
                Optional cache to avoid repeated API calls.
        """
        super().__init__(
            api_key=_agent_jwt(),
            model_name=model_name,
            dimensions=dimensions,
            embedding_cache=embedding_cache,
            base_url=_gate_base_url(),
        )
