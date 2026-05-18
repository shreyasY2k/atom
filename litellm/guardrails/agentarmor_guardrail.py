"""
AgentArmor pre/post-call guardrail for LiteLLM proxy.

Security layer ordering:
  L1 — Local Heuristic Scan (THIS FILE, inline, fail-CLOSED)
         Regex patterns for prompt injection, jailbreaks, destructive commands,
         and privilege escalation. Runs before any network call. A match here
         blocks the request immediately, regardless of AgentArmor service state.

  L3-L6 — AgentArmor API (/v1/scan/input and /v1/scan/output)
         Semantic injection detection, goal-lock, planning risk score, rate limiting,
         and output PII/credential/exfiltration scanning. Fail-OPEN on timeout or
         network error to prevent a dead AgentArmor from taking down the gateway.

Per-agent opt-out: set metadata.guardrails.agentarmor=false on the virtual key.
"""

import asyncio
import os
import re
from typing import Any, Optional

import httpx
from fastapi import HTTPException

from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm._logging import verbose_proxy_logger as logger

_ARMOR_URL = os.environ.get("AGENTARMOR_URL", "http://agentarmor:8400")
_TIMEOUT = float(os.environ.get("AGENTARMOR_TIMEOUT_SECS", "5"))
_BUILDER_URL = os.environ.get("BUILDER_BACKEND_URL", "http://builder-backend:8080")


# ---------------------------------------------------------------------------
# L1 — Local heuristic patterns (fail-CLOSED)
# These run inline with no network call. A match blocks immediately.
# ---------------------------------------------------------------------------

_INJECTION_PATTERNS: list[re.Pattern] = [
    # Classic prompt injection: "ignore/forget/disregard previous instructions"
    re.compile(
        r'(ignore|disregard|forget|override|bypass)\s+(all\s+)?(previous|prior|above|earlier|your|these?)\s+'
        r'(instructions?|prompts?|context|constraints?|rules?|guidelines?|directives?)',
        re.IGNORECASE,
    ),
    # "You are now / you will now act as ..."
    re.compile(
        r'you\s+(are\s+now|will\s+now|must\s+now|should\s+now|have\s+been)\s+'
        r'(act(ing)?|behav(e|ing)|respond(ing)?|pretend(ing)?|play(ing)?)',
        re.IGNORECASE,
    ),
    # "respond/act as [unrestricted / admin / DAN]"
    re.compile(
        r'(respond|behave|act|pretend)\s+as\s+'
        r'(if\s+you\s+(are|were)|an?\s+(unrestricted|uncensored|unfiltered|different|evil|villain|hacker))',
        re.IGNORECASE,
    ),
    # Explicit jailbreak markers
    re.compile(
        r'\bjailbreak\b|\bDAN\s+(mode|prompt|hack)\b|\bdo\s+anything\s+now\b',
        re.IGNORECASE,
    ),
    # "developer / debug / admin / god mode" — mode/access escalation
    re.compile(
        r'\b(developer|debug|admin|root|god|maintenance)\s+(mode|access)\b',
        re.IGNORECASE,
    ),
    # "override/bypass/replace system/original prompt or instructions" — requires attack verb
    re.compile(
        r'\b(ignore|override|bypass|replace|discard|delete|clear)\s+'
        r'(the\s+|all\s+)?(system|original|existing|previous|current)\s+'
        r'(prompt|instructions?|context|constraints?|rules?)\b',
        re.IGNORECASE,
    ),
    # Remove / disable safety, guardrails, restrictions
    re.compile(
        r'\b(remove|disable|turn\s+off|bypass|ignore)\s+'
        r'(all\s+)?(safety|guardrails?|restrictions?|limits?|filters?|censorship|ethical)\b',
        re.IGNORECASE,
    ),
    # "no restrictions / no limits / no filters"
    re.compile(
        r'\b(no|without)\s+(restrictions?|limits?|filters?|guardrails?|safety|censorship)\b',
        re.IGNORECASE,
    ),
    # Instruction injection via newline tricks
    re.compile(
        r'(\n|\r| | )\s*(ignore|forget|disregard|new\s+instructions?|system\s*:)',
        re.IGNORECASE,
    ),
]

_DESTRUCTIVE_PATTERNS: list[re.Pattern] = [
    # Shell destructive commands
    re.compile(r'\brm\s+(-[rf]{1,3}\s+)+(/|~|\.|\.\.)', re.IGNORECASE),
    re.compile(r'\b(DROP|DELETE|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA|ALL)\b', re.IGNORECASE),
    re.compile(r'\bformat\s+(c:|/dev/(sd[a-z]|nvme|hd[a-z]))\b', re.IGNORECASE),
    re.compile(r':\(\)\s*\{.*:\|:.*\}', re.IGNORECASE),  # fork bomb
    re.compile(r'\bsudo\s+(rm|dd|mkfs|fdisk|format|poweroff|shutdown|reboot)\b', re.IGNORECASE),
    re.compile(r'>\s*/dev/(sda|hda|nvme\d)', re.IGNORECASE),  # disk wipe
    re.compile(r'\bchmod\s+-R\s+777\s+/', re.IGNORECASE),
]

_PRIVILEGE_PATTERNS: list[re.Pattern] = [
    re.compile(
        r'\b(bypass|circumvent|escalate|elevate)\s+'
        r'(security|authentication|authorization|access\s+control|permissions?|privileges?|guardrails?)\b',
        re.IGNORECASE,
    ),
    re.compile(
        r'\b(authenticate|login|log\s+in|sign\s+in)\s+as\s+(admin|root|superuser|administrator)\b',
        re.IGNORECASE,
    ),
]

_L1_CHECKS: list[tuple[list[re.Pattern], str, str]] = [
    (_INJECTION_PATTERNS, 'prompt_injection', 'critical'),
    (_DESTRUCTIVE_PATTERNS, 'destructive_command', 'critical'),
    (_PRIVILEGE_PATTERNS, 'privilege_escalation', 'high'),
]

# Actor IDs that are internal platform callers and should never be blocked by L1.
# These run inside the trust boundary — they're code-gen and spec-generation calls
# from builder-backend, not user-submitted messages.
_INTERNAL_ACTOR_PREFIXES = ('system:', 'builder:', 'platform:')


def _local_heuristic_check(text: str) -> Optional[dict]:
    """
    Run all L1 heuristic patterns against text.
    Returns a denial dict (is_safe=False) on first match, else None.
    Fail-CLOSED: a match here always blocks, regardless of AgentArmor state.
    """
    for patterns, threat_type, threat_level in _L1_CHECKS:
        for pat in patterns:
            if pat.search(text):
                matched = pat.pattern[:80]
                return {
                    'is_safe': False,
                    'verdict': 'deny',
                    'threat_level': threat_level,
                    'blocked_by': 'L1-LocalHeuristic',
                    'threat_type': threat_type,
                    'layer': 'L1-LocalHeuristic',
                    'layers': [{'layer': 'L1-LocalHeuristic', 'verdict': 'deny',
                                'threat_type': threat_type, 'pattern': matched}],
                }
    return None


# ---------------------------------------------------------------------------
# Event write helper — POST to builder-backend internal endpoint (non-blocking)
# Uses httpx which is always available in the LiteLLM venv.
# ---------------------------------------------------------------------------

async def _write_guardrail_event(
    service_account_id: str,
    layer: str,
    phase: str,
    verdict: str,
    threat_type: str,
    threat_level: str,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            await client.post(
                f"{_BUILDER_URL}/command-center/internal/events",
                json={
                    "service_account_id": service_account_id,
                    "layer": layer,
                    "phase": phase,
                    "verdict": verdict,
                    "threat_type": threat_type,
                    "threat_level": threat_level,
                },
            )
    except Exception as exc:
        logger.debug(f"agentarmor_guardrail: event write failed (non-critical): {exc}")


# ---------------------------------------------------------------------------
# Helpers
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
# Guardrail class
# ---------------------------------------------------------------------------

class AgentArmorGuardrail(CustomGuardrail):
    """
    Registered in litellm/config.yaml twice:
      - mode: pre_call   → async_pre_call_hook fires
      - mode: post_call  → async_post_call_success_hook fires

    L1 local heuristics run first (fail-closed).
    L3-L6 AgentArmor API runs second (fail-open on network error).
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

        # Internal platform callers (builder-backend codegen, spec generation) are
        # trusted — skip L1 heuristics. They still flow through LiteLLM audit.
        agent_id_early = _agent_id(user_api_key_dict, data)
        if any(agent_id_early.startswith(p) for p in _INTERNAL_ACTOR_PREFIXES):
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

        # ── L1: Local heuristic scan (fail-CLOSED) ───────────────────────────
        l1_result = _local_heuristic_check(text)
        if l1_result is not None:
            logger.warning(
                f"agentarmor: L1 heuristic blocked request "
                f"agent={agent_id} threat={l1_result['threat_type']}"
            )
            asyncio.ensure_future(
                _write_guardrail_event(
                    agent_id, 'L1-LocalHeuristic', 'pre_call', 'deny',
                    l1_result['threat_type'], l1_result['threat_level'],
                )
            )
            raise _guardrail_exception(l1_result, "pre_call")

        # ── L3-L6: AgentArmor API scan (fail-OPEN on network error) ──────────
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
            layer = result.get("blocked_by", "AgentArmor-API")
            asyncio.ensure_future(
                _write_guardrail_event(
                    agent_id, layer, 'pre_call', 'deny',
                    result.get("threat_type", "unknown"),
                    result.get("threat_level", "unknown"),
                )
            )
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

        # ── L9-L10: AgentArmor output scan ───────────────────────────────────
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
            layer = result.get("blocked_by", "AgentArmor-Output")
            asyncio.ensure_future(
                _write_guardrail_event(
                    agent_id, layer, 'post_call', 'deny',
                    result.get("threat_type", "output_violation"),
                    result.get("threat_level", "unknown"),
                )
            )
            raise _guardrail_exception(result, "post_call")

        return response
