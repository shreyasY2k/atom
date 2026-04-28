# -*- coding: utf-8 -*-
"""
_atom_model.py — ATOM chat model for agentscope.

All LLM calls are routed through GATE using the agent's JWT.
Developers specify only model_name; endpoint and credentials are
injected from ATOM environment variables — they cannot be overridden
in agent config. This is by design: no agent can bypass GATE.

Environment variables (injected by atom-runtime at pod start):
    ATOM_GATE_URL   — e.g. http://gate.atom-system.svc
    ATOM_DOMAIN_ID  — domain UUID
    ATOM_AGENT_ID   — agent UUID
    ATOM_AGENT_JWT  — RS256 JWT for this agent

Usage in agent code:
    from agentscope.model import AtomChatModel

    model = AtomChatModel(
        model_name="gpt-4o",
        stream=False,
        generate_kwargs={"temperature": 0.7},
    )
    agent = ReActAgent(name="myagent", model=model, ...)
"""

import os
from typing import Any

from ._openai_model import OpenAIChatModel
from ..types import JSONSerializableObject


def _gate_base_url() -> str:
    """Build the GATE endpoint URL for this agent's LLM path."""
    gate_url = os.environ["ATOM_GATE_URL"].rstrip("/")
    domain_id = os.environ["ATOM_DOMAIN_ID"]
    agent_id = os.environ["ATOM_AGENT_ID"]
    return f"{gate_url}/domain/{domain_id}/agent/{agent_id}/v1"


def _agent_jwt() -> str:
    jwt = os.environ.get("ATOM_AGENT_JWT")
    if not jwt:
        raise EnvironmentError(
            "ATOM_AGENT_JWT is not set. "
            "This var is injected by atom-runtime when the agent pod starts. "
            "For local dev, set it in .env from a token issued by atom-studio.",
        )
    return jwt


class AtomChatModel(OpenAIChatModel):
    """
    Chat model that routes all LLM calls through GATE → atom-llm.

    This is the only chat model available in atom-sdk. The base_url
    and api_key are always read from ATOM env vars; they cannot be
    supplied via constructor or config — no agent can bypass GATE.
    """

    def __init__(
        self,
        model_name: str,
        stream: bool = False,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        **_ignored: Any,  # silently ignore api_key / base_url / client_kwargs
    ) -> None:
        """Initialize AtomChatModel.

        Args:
            model_name (`str`):
                The model name forwarded to atom-llm (e.g. ``"gpt-4o"``).
                Must be in the agent's ``allowed_models`` list.
            stream (`bool`, default ``False``):
                Whether to use streaming output.
            generate_kwargs (`dict | None`, optional):
                Extra keyword arguments passed to the LiteLLM completion call,
                e.g. ``{"temperature": 0.7}``.
        """
        super().__init__(
            model_name=model_name,
            api_key=_agent_jwt(),
            stream=stream,
            client_kwargs={"base_url": _gate_base_url()},
            generate_kwargs=generate_kwargs or {},
        )
