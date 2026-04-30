"""
Core ATOM SDK — thin wrappers over the agentscope extensions
already in atom-sdk/src/agentscope/.
"""

import os

import agentscope


def init_atom(
    gate_url: str | None = None,
    agent_jwt: str | None = None,
    studio_url: str | None = None,
    agent_id: str | None = None,
    domain_id: str | None = None,
) -> None:
    """
    Initialise the ATOM SDK.

    Call once at application startup before creating any agents.

    Args:
        gate_url:   ATOM GATE URL (overrides ATOM_GATE_URL env var).
        agent_jwt:  Agent JWT (overrides ATOM_AGENT_JWT env var).
        studio_url: atom-studio URL for run recording (overrides ATOM_STUDIO_URL).
        agent_id:   Agent UUID (overrides ATOM_AGENT_ID env var).
        domain_id:  Domain UUID (overrides ATOM_DOMAIN_ID env var).
    """
    if gate_url:
        os.environ["ATOM_GATE_URL"] = gate_url
    if agent_jwt:
        os.environ["ATOM_AGENT_JWT"] = agent_jwt
    if agent_id:
        os.environ["ATOM_AGENT_ID"] = agent_id
    if domain_id:
        os.environ["ATOM_DOMAIN_ID"] = domain_id

    model_configs = [
        {
            "config_name": "atom-default",
            "model_type": "openai_chat",
            "model_name": os.environ.get("ATOM_MODEL_NAME", "gemini-2.5-flash"),
            "api_key": os.environ.get("ATOM_AGENT_JWT", ""),
            "client_args": {
                "base_url": f"{os.environ.get('ATOM_GATE_URL', 'http://localhost:8080')}"
                f"/domain/{os.environ.get('ATOM_DOMAIN_ID', '')}"
                f"/agent/{os.environ.get('ATOM_AGENT_ID', '')}/v1/",
            },
        }
    ]

    init_kwargs: dict = {"model_configs": model_configs}

    # If studio_url is provided, route runs to atom-studio's tRPC endpoint
    if studio_url or os.environ.get("ATOM_STUDIO_URL"):
        init_kwargs["studio_url"] = studio_url or os.environ["ATOM_STUDIO_URL"]

    agentscope.init(**init_kwargs)


# Re-export the AtomChatModel from the agentscope fork for convenience
try:
    from agentscope.model import AtomChatModel  # type: ignore[import]
except ImportError:
    # Upstream agentscope without ATOM extensions — provide a shim
    class AtomChatModel:  # type: ignore[no-redef]
        """Placeholder: install the ATOM fork of agentscope for full support."""

        def __init__(self, *args, **kwargs):
            raise ImportError(
                "AtomChatModel requires the ATOM agentscope fork. "
                "See: https://github.com/shreyasY2k/atom/tree/main/atom-sdk"
            )


__all__ = ["init_atom", "AtomChatModel"]
