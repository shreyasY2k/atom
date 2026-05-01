"""
atom-llm/atom_extensions/provision.py

Thin wrappers around LiteLLM's native team/key API.
All calls go to LiteLLM's own proxy on localhost:4000 using LITELLM_MASTER_KEY.

ATOM ↔ LiteLLM mapping:
  ATOM Domain → LiteLLM Team   (domain.id used as team_id — same UUID, no extra lookup)
  ATOM Agent  → LiteLLM Key    (team-scoped virtual key with rate limits + model list)

LiteLLM 1.83+ dropped /agent/new in favour of /key/generate with team_id.
"""

import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/atom", tags=["atom-provision"])

LITELLM_BASE = "http://localhost:4000"


def _auth_headers() -> dict:
    key = os.environ.get("LITELLM_MASTER_KEY")
    if not key:
        raise RuntimeError("LITELLM_MASTER_KEY is not set")
    return {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}


# ── Request / Response models ─────────────────────────────────────────────────


class ProvisionDomainRequest(BaseModel):
    domain_id: str
    domain_name: str


class ProvisionDomainResponse(BaseModel):
    team_id: str
    team_alias: str


class ProvisionAgentRequest(BaseModel):
    agent_id: str
    agent_name: str
    team_id: str  # domain.litellm_team_id (= domain.id)
    allowed_models: list[str]
    rpm_limit: int = 60
    tpm_limit: int = 100_000
    guardrails: list[str] = []


class ProvisionAgentResponse(BaseModel):
    litellm_agent_id: str  # token_id of the generated key
    virtual_key: str  # the sk-... key agents use


class DeprovisionAgentRequest(BaseModel):
    virtual_key: str  # the sk-... key to delete


class DeprovisionDomainRequest(BaseModel):
    litellm_id: str  # the LiteLLM team_id to delete


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post("/provision_domain", response_model=ProvisionDomainResponse)
async def provision_domain(req: ProvisionDomainRequest):
    """
    Called by atom-studio when a domain is created.
    Creates a LiteLLM team using domain.id as team_id (1:1 mapping, no lookup needed).
    """
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LITELLM_BASE}/team/new",
            headers=_auth_headers(),
            json={
                "team_id": req.domain_id,
                "team_alias": req.domain_name,
            },
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"LiteLLM team/new failed: {resp.text}")
        data = resp.json()

    return ProvisionDomainResponse(
        team_id=data.get("team_id", req.domain_id),
        team_alias=data.get("team_alias", req.domain_name),
    )


@router.post("/provision_agent", response_model=ProvisionAgentResponse)
async def provision_agent(req: ProvisionAgentRequest):
    """
    Called by atom-studio when an agent is created.
    Creates a LiteLLM virtual key scoped to the team (domain) with model + rate limits.
    The returned virtual_key is stored AES-GCM encrypted in agents.litellm_virtual_key.

    LiteLLM 1.83+ uses /key/generate instead of the removed /agent/new.
    """
    key_body: dict = {
        "key_alias": f"{req.agent_name}-{req.agent_id[:8]}",  # globally unique
        "user_id": req.agent_id,
        "team_id": req.team_id,
        "models": req.allowed_models,
        "tpm_limit": req.tpm_limit,
        "rpm_limit": req.rpm_limit,
    }
    if req.guardrails:
        key_body["guardrails"] = req.guardrails

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LITELLM_BASE}/key/generate",
            headers=_auth_headers(),
            json=key_body,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"LiteLLM key/generate failed: {resp.text}")
        data = resp.json()

    virtual_key = data.get("key")
    token_id = data.get("token_id") or data.get("id") or req.agent_id
    if not virtual_key:
        raise HTTPException(502, f"LiteLLM key/generate returned no key: {data}")

    return ProvisionAgentResponse(
        litellm_agent_id=token_id,
        virtual_key=virtual_key,
    )


@router.delete("/deprovision_agent")
async def deprovision_agent(req: DeprovisionAgentRequest):
    """Called when an agent is deleted from atom-studio."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LITELLM_BASE}/key/delete",
            headers=_auth_headers(),
            json={"keys": [req.virtual_key]},
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"LiteLLM key/delete failed: {resp.text}")
    return {"deleted": True}


@router.delete("/deprovision_domain")
async def deprovision_domain(req: DeprovisionDomainRequest):
    """Called when a domain is deleted from atom-studio."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LITELLM_BASE}/team/delete",
            headers=_auth_headers(),
            json={"team_ids": [req.litellm_id]},
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(502, f"LiteLLM team/delete failed: {resp.text}")
    return {"deleted": True}
