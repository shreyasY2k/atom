"""
atom_extensions/provision.py

POST /atom/provision_agent  — create a LiteLLM virtual key for an ATOM agent.

Called by atom-studio at agent provisioning time. The returned virtual key is
stored (encrypted) in agents.litellm_virtual_key in ATOM's Postgres.
"""

import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.auth.user_api_key_auth import user_api_key_auth
from litellm.proxy.management_endpoints.key_management_endpoints import generate_key_fn
from litellm.proxy._types import GenerateKeyRequest

atom_router = APIRouter(prefix="/atom", tags=["ATOM Extensions"])


class ProvisionAgentRequest(BaseModel):
    agent_id: str
    allowed_models: List[str] = []
    rpm_limit: Optional[int] = 100
    tpm_limit: Optional[int] = 100_000


class ProvisionAgentResponse(BaseModel):
    virtual_key: str
    agent_id: str


@atom_router.post("/provision_agent", response_model=ProvisionAgentResponse)
async def provision_agent(
    request: ProvisionAgentRequest,
    user_api_key_dict: UserAPIKeyAuth = Depends(user_api_key_auth),
) -> ProvisionAgentResponse:
    """
    Create a LiteLLM virtual key scoped to a single ATOM agent.

    The caller must present the LITELLM_MASTER_KEY (or an admin key) in the
    Authorization header. atom-studio is the only intended caller.
    """
    key_alias = f"atom-agent-{request.agent_id[:8]}"
    # Force the key to start with sk-atom- for easy identification.
    custom_key = f"sk-atom-{request.agent_id[:8]}-{secrets.token_urlsafe(16)}"

    gen_request = GenerateKeyRequest(
        key_alias=key_alias,
        key=custom_key,
        models=request.allowed_models if request.allowed_models else [],
        rpm_limit=request.rpm_limit,
        tpm_limit=request.tpm_limit,
        metadata={"atom_agent_id": request.agent_id},
    )

    try:
        response = await generate_key_fn(
            data=gen_request,
            user_api_key_dict=user_api_key_dict,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Key generation failed: {exc}",
        ) from exc

    return ProvisionAgentResponse(
        virtual_key=response.key,
        agent_id=request.agent_id,
    )
