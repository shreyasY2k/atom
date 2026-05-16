"""
AgentArmor pre/post-call guardrail for LiteLLM proxy.

Pre-call  — scans input messages for prompt injection and policy violations.
Post-call — scans model output for PII, credentials, and exfiltration.

Default-on for all agents. Per-agent opt-out is stored in the LiteLLM virtual
key metadata at deploy time:

    metadata:
      guardrails:
        agentarmor: false   # disable for this agent

On timeout or network error the guardrail fails **open** (request is allowed
through) and a warning is logged — this prevents a dead AgentArmor container
from taking down the LLM gateway.

On a positive scan result (is_safe=False) the guardrail raises an HTTP 400
with the full AgentArmor response so callers can distinguish a guardrail
block from a model error.
"""

import os
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm._logging import verbose_proxy_logger as logger

_ARMOR_URL = os.environ.get("AGENTARMOR_URL", "http://agentarmor:8400")
_TIMEOUT = float(os.environ.get("AGENTARMOR_TIMEOUT_SECS", "5"))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _armor_enabled(user_api_key_dict) -> bool:
    metadata = getattr(user_api_key_dict, "metadata", {}) or {}
    return metadata.get("guardrails", {}).get("agentarmor", True)


def _agent_id(user_api_key_dict, data: dict) -> str:
    return (
        getattr(user_api_key_dict, "key_alias", None)
        or data.get("user", "unknown")
    )


def _guardrail_exception(result: dict, phase: str) -> HTTPException:
    blocked_by = result.get("blocked_by") or result.get("layer", "guardrail")
    threat = result.get("threat_level", "unknown")
    layers = result.get("layers") or result.get("layer_results", [])
    return HTTPException(
        status_code=400,
        detail={
            "error": "guardrail_violation",
            "guardrail": "agentarmor",
            "phase": phase,
            "verdict": result.get("verdict", "deny"),
            "threat_level": threat,
            "blocked_by": blocked_by,
            "layers": layers,
            "message": (
                f"AgentArmor {phase} guardrail blocked this request "
                f"(threat: {threat}, blocked_by: {blocked_by})"
            ),
        },
    )


# ---------------------------------------------------------------------------
# guardrail class
# ---------------------------------------------------------------------------

class AgentArmorGuardrail(CustomGuardrail):
    """
    Registered in litellm/config.yaml twice:
      - mode: pre_call   → async_pre_call_hook fires
      - mode: post_call  → async_post_call_success_hook fires
    """

    async def async_pre_call_hook(
        self,
        user_api_key_dict,
        cache,
        data: dict,
        call_type: str,
    ) -> Optional[dict]:
        if not _armor_enabled(user_api_key_dict):
            return None

        messages = data.get("messages", [])
        text = " ".join(
            m.get("content", "")
            for m in messages
            if isinstance(m.get("content"), str)
        ).strip()
        if not text:
            return None

        agent_id = _agent_id(user_api_key_dict, data)

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    f"{_ARMOR_URL}/v1/scan/input",
                    json={
                        "text": text,
                        "agent_id": agent_id,
                        "context": {"call_type": call_type},
                    },
                )
                resp.raise_for_status()
                result = resp.json()
        except httpx.TimeoutException:
            logger.warning("agentarmor: pre-call scan timed out — allowing request")
            return None
        except Exception as exc:
            logger.warning(f"agentarmor: pre-call scan error ({exc}) — allowing request")
            return None

        if not result.get("is_safe", True):
            raise _guardrail_exception(result, "pre_call")

        return None

    async def async_post_call_success_hook(
        self,
        data: dict,
        user_api_key_dict,
        response: Any,
    ) -> Any:
        if not _armor_enabled(user_api_key_dict):
            return response

        # Extract text from ModelResponse
        try:
            choices = getattr(response, "choices", None) or response.get("choices", [])
            if not choices:
                return response
            first = choices[0]
            if hasattr(first, "message"):
                output_text = first.message.content or ""
            else:
                output_text = first.get("message", {}).get("content", "")
        except Exception:
            return response

        if not output_text:
            return response

        agent_id = _agent_id(user_api_key_dict, data)

        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.post(
                    f"{_ARMOR_URL}/v1/scan/output",
                    json={
                        "text": output_text,
                        "agent_id": agent_id,
                    },
                )
                resp.raise_for_status()
                result = resp.json()
        except httpx.TimeoutException:
            logger.warning("agentarmor: post-call scan timed out — passing response through")
            return response
        except Exception as exc:
            logger.warning(f"agentarmor: post-call scan error ({exc}) — passing response through")
            return response

        if not result.get("is_safe", True):
            raise _guardrail_exception(result, "post_call")

        return response
