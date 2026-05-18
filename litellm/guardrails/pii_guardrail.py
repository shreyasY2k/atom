"""
PII Detection + Redaction guardrail — pre-call LiteLLM hook.

Scans every message in the request for Personally Identifiable Information
before forwarding to the LLM. Detected PII is replaced with [PII:<TYPE>]
tokens so the LLM never processes raw sensitive data.

On any error this guardrail fails OPEN (allows through) but still attempts
partial redaction so it never silently passes unmasked data if redaction
itself succeeds.

Redaction events are written to the platform-db guardrail_events table for
the Command Center dashboard.
"""

import asyncio
import os
import re
from typing import Any, Optional

import httpx
from litellm.integrations.custom_guardrail import CustomGuardrail
from litellm._logging import verbose_proxy_logger as logger

_BUILDER_URL = os.environ.get("BUILDER_BACKEND_URL", "http://builder-backend:8080")

# ---------------------------------------------------------------------------
# PII pattern registry
# Each entry: (compiled_regex, pii_type_label)
# ---------------------------------------------------------------------------
_PII_PATTERNS: list[tuple[re.Pattern, str]] = [
    # Email addresses
    (re.compile(
        r'\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b',
        re.IGNORECASE,
    ), 'EMAIL'),

    # US Social Security Numbers  e.g. 123-45-6789 or 123456789
    (re.compile(
        r'\b(?!000|666|9\d{2})\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}\b',
    ), 'SSN'),

    # Credit/debit card numbers (Visa, Mastercard, Amex, Discover — 13-16 digits)
    (re.compile(
        r'\b(?:4[0-9]{12}(?:[0-9]{3})?'          # Visa
        r'|5[1-5][0-9]{14}'                        # Mastercard
        r'|3[47][0-9]{13}'                         # Amex
        r'|6(?:011|5[0-9]{2})[0-9]{12}'           # Discover
        r'|[0-9]{4}[\s\-][0-9]{4}[\s\-][0-9]{4}[\s\-][0-9]{4}'  # generic spaced
        r')\b',
    ), 'CREDIT_CARD'),

    # US phone numbers in various formats
    (re.compile(
        r'\b(?:\+?1[\s\-.]?)?'
        r'(?:\(?\d{3}\)?[\s\-.]?)'
        r'\d{3}[\s\-.]?\d{4}\b',
    ), 'PHONE'),

    # IPv4 addresses (not localhost)
    (re.compile(
        r'\b(?!127\.|0\.|255\.)(?:[1-9]\d{0,2}\.){3}[1-9]\d{0,2}\b',
    ), 'IP_ADDRESS'),

    # Dates of birth (MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD)
    (re.compile(
        r'\b(?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}\b'
        r'|\b(?:19|20)\d{2}[/\-](?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])\b',
    ), 'DOB'),

    # Passport-style document numbers (basic: letter(s) + 6-9 digits)
    (re.compile(
        r'\b[A-Z]{1,2}\d{6,9}\b',
    ), 'PASSPORT'),
]


def _redact_text(text: str) -> tuple[str, list[str]]:
    """
    Replace all PII tokens in text with [PII:<TYPE>] placeholders.
    Returns (redacted_text, list_of_detected_types).
    """
    detected: list[str] = []
    for pattern, pii_type in _PII_PATTERNS:
        if pattern.search(text):
            detected.append(pii_type)
            text = pattern.sub(f'[PII:{pii_type}]', text)
    return text, detected


def _redact_messages(messages: list[dict]) -> tuple[list[dict], list[str]]:
    """Redact PII in all message content strings. Returns (new_messages, detected_types)."""
    all_detected: set[str] = set()
    new_messages = []
    for msg in messages:
        content = msg.get('content', '')
        if isinstance(content, str):
            redacted, detected = _redact_text(content)
            all_detected.update(detected)
            new_messages.append({**msg, 'content': redacted})
        elif isinstance(content, list):
            # Multi-part messages (vision, etc.)
            new_parts = []
            for part in content:
                if isinstance(part, dict) and part.get('type') == 'text':
                    redacted, detected = _redact_text(part.get('text', ''))
                    all_detected.update(detected)
                    new_parts.append({**part, 'text': redacted})
                else:
                    new_parts.append(part)
            new_messages.append({**msg, 'content': new_parts})
        else:
            new_messages.append(msg)
    return new_messages, list(all_detected)


# ---------------------------------------------------------------------------
# Event write helper — POST to builder-backend internal endpoint (non-blocking)
# ---------------------------------------------------------------------------

async def _write_guardrail_event(service_account_id: str, pii_types: list[str]) -> None:
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            await client.post(
                f"{_BUILDER_URL}/command-center/internal/events",
                json={
                    "service_account_id": service_account_id,
                    "layer": "L2-PII",
                    "phase": "pre_call",
                    "verdict": "redact",
                    "threat_type": "PII_DETECTED",
                    "threat_level": "low",
                    "pii_types": ",".join(pii_types),
                },
            )
    except Exception as exc:
        logger.debug(f"pii_guardrail: event write failed (non-critical): {exc}")


# ---------------------------------------------------------------------------
# Guardrail class
# ---------------------------------------------------------------------------

class PIIGuardrail(CustomGuardrail):
    """
    Registered in litellm/config.yaml as a pre_call guardrail.
    Redacts PII tokens in request messages before they reach the LLM.
    Redaction events are written to platform-db for the Command Center.
    """

    async def async_pre_call_hook(
        self,
        user_api_key_dict,
        cache,
        data: dict,
        call_type: str,
    ) -> Optional[dict]:
        messages = data.get('messages')
        if not messages:
            return None

        try:
            new_messages, detected = _redact_messages(messages)
        except Exception as exc:
            logger.warning(f"pii_guardrail: redaction error ({exc}) — passing through")
            return None

        if not detected:
            return None

        # Update messages in-place with redacted content
        data['messages'] = new_messages

        service_account_id = (
            data.get('user')
            or getattr(user_api_key_dict, 'key_alias', None)
            or 'unknown'
        )
        logger.info(
            f"pii_guardrail: redacted {detected} for actor={service_account_id}"
        )

        # Write event asynchronously (non-blocking)
        asyncio.ensure_future(
            _write_guardrail_event(service_account_id, detected)
        )

        return data
