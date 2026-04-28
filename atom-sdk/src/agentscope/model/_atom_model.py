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

With memory (inject relevant context before every LLM call):
    from atom_memory import MemoryManager  # installed in atom-sdk env

    model = AtomChatModel(
        model_name="gpt-4o",
        memory_manager=mem,  # optional MemoryManager
    )
"""

import os
from typing import Any, TYPE_CHECKING

from ._openai_model import OpenAIChatModel
from ..types import JSONSerializableObject

if TYPE_CHECKING:
    # Avoid hard runtime dependency on atom-memory in atom-sdk;
    # MemoryManager is duck-typed at runtime.
    from atom_memory import MemoryManager  # type: ignore[import]


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


async def _inject_memories(
    messages: list[dict],
    memory_manager: "MemoryManager",
    top_k: int = 5,
) -> list[dict]:
    """
    Recall relevant memories and prepend them to the system prompt.

    Uses the last user message as the recall query. If no memories are
    found the messages list is returned unchanged.
    """
    user_msgs = [m for m in messages if m.get("role") == "user"]
    if not user_msgs:
        return messages

    query = user_msgs[-1].get("content") or ""
    if not query:
        return messages

    try:
        memories = await memory_manager.recall(query, top_k=top_k)
    except Exception:
        return messages  # memory failure must never block an LLM call

    if not memories:
        return messages

    memory_lines = "\n".join(f"- {m['content']}" for m in memories)
    memories_block = f"Relevant memories:\n{memory_lines}"

    messages = list(messages)  # shallow copy — don't mutate caller's list
    sys_idx = next(
        (i for i, m in enumerate(messages) if m.get("role") == "system"),
        None,
    )
    if sys_idx is not None:
        sys_msg = dict(messages[sys_idx])
        sys_msg["content"] = f"{sys_msg.get('content', '')}\n\n{memories_block}"
        messages[sys_idx] = sys_msg
    else:
        messages.insert(0, {"role": "system", "content": memories_block})

    return messages


class AtomChatModel(OpenAIChatModel):
    """
    Chat model that routes all LLM calls through GATE → atom-llm.

    This is the only chat model available in atom-sdk. The base_url
    and api_key are always read from ATOM env vars; they cannot be
    supplied via constructor or config — no agent can bypass GATE.

    Pass a MemoryManager to automatically inject recalled memories into
    the system prompt before every LLM call.
    """

    def __init__(
        self,
        model_name: str,
        stream: bool = False,
        generate_kwargs: dict[str, JSONSerializableObject] | None = None,
        memory_manager: "MemoryManager | None" = None,
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
            memory_manager (`MemoryManager | None`, optional):
                When provided, the top-5 most relevant memories are recalled
                and injected into the system prompt before every LLM call.
                Recall failures are silently ignored so they never block calls.
        """
        super().__init__(
            model_name=model_name,
            api_key=_agent_jwt(),
            stream=stream,
            client_kwargs={"base_url": _gate_base_url()},
            generate_kwargs=generate_kwargs or {},
        )
        self.memory_manager = memory_manager

    async def __call__(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> Any:
        if self.memory_manager is not None:
            messages = await _inject_memories(messages, self.memory_manager)
        return await super().__call__(messages=messages, **kwargs)
