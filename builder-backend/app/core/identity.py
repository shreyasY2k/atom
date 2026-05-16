"""Service-account identity issuance and revocation via LiteLLM virtual keys."""

import hashlib
import yaml

from app.core.litellm_client import generate_virtual_key, delete_virtual_key
from app.core.schema import AgentSpec


def provision_identity(name: str, owner: str = "user:default@atom.io") -> tuple[str, str]:
    """Issue a LiteLLM virtual key at agent-create time (no spec needed yet).

    Returns (service_account_id, virtual_key_string).
    """
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    svc_id = f"svc-acct-{name}-{ts[-8:]}"
    result = generate_virtual_key(
        alias=svc_id,
        metadata={
            "actor_type": "agent",
            "agent_name": name,
            "version": "v0",
            "owner": owner,
            "tool_allowlist": [],
        },
        models=["gemini-3.1-pro", "gemini-3-flash", "gemini-embedding"],
        max_budget=10.0,
        tpm_limit=200_000,
    )
    return svc_id, result["key"]


def update_identity_tools(virtual_key: str, tool_names: list) -> None:
    """Update the LiteLLM key's tool allowlist as tools are added/removed."""
    from app.core.litellm_client import update_virtual_key
    update_virtual_key(virtual_key, {"tool_allowlist": tool_names})


def _spec_hash(spec_dict: dict) -> str:
    return hashlib.sha256(yaml.dump(spec_dict, sort_keys=True).encode()).hexdigest()


def compute_service_account_id(name: str, spec_dict: dict) -> str:
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"svc-acct-{name}-{_spec_hash(spec_dict)[:6]}{ts[-4:]}"


def issue_identity(
    name: str, spec_dict: dict, spec: AgentSpec, owner: str = "user:default@atom.io"
) -> tuple[str, str]:
    """
    Issue a LiteLLM virtual key for the agent.
    Returns (service_account_id, virtual_key_string).
    """
    svc_id = compute_service_account_id(name, spec_dict)
    tool_allowlist = [t for ag in spec.spec.agents for t in ag.tools]

    result = generate_virtual_key(
        alias=svc_id,
        metadata={
            "actor_type": "agent",
            "agent_name": name,
            "version": spec.metadata.version,
            "owner": owner,
            "tool_allowlist": tool_allowlist,
        },
        models=["gemini-3.1-pro", "gemini-3-flash", "gemini-embedding"],
        max_budget=10.0,
        tpm_limit=200_000,
    )
    return svc_id, result["key"]


def revoke_identity(virtual_key: str) -> None:
    """Revoke the agent's virtual key."""
    delete_virtual_key(virtual_key)
