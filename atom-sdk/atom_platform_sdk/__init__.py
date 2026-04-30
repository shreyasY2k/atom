"""
atom-platform-sdk — ATOM AI Governance Platform Agent SDK

Extends agentscope with ATOM-specific model wrapper, HITL hooks,
and audit instrumentation.

Quick start:
    pip install atom-platform-sdk

    import agentscope
    from atom_platform_sdk import AtomChatModel, init_atom

    init_atom(
        gate_url="http://gate.atom.local",
        agent_jwt="<token-from-studio>",
        studio_url="http://studio.atom.local",  # optional: sends runs to atom-studio
    )

    agent = agentscope.agents.ReActAgent(
        name="my-agent",
        model_config_name="atom-default",
        sys_prompt="You are a BFSI compliance assistant.",
    )
"""

from .core import AtomChatModel, init_atom

__all__ = ["AtomChatModel", "init_atom"]
__version__ = "0.1.0"
