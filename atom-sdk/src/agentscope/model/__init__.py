# -*- coding: utf-8 -*-
"""
The model module — atom-sdk fork.

Only AtomChatModel is exported. All provider-specific wrappers have been
removed; LLM calls must flow through GATE. See UPSTREAM_DIFF.md.
"""

from ._model_base import ChatModelBase
from ._model_response import ChatResponse
from ._model_usage import ChatUsage
from ._atom_model import AtomChatModel

__all__ = [
    "ChatModelBase",
    "ChatResponse",
    "ChatUsage",
    "AtomChatModel",
]
