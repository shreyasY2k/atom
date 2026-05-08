"""LiteLLM admin API client — key lifecycle and chat completions."""

import os
import httpx

_BASE = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000")
_KEY  = os.environ.get("LITELLM_MASTER_KEY", "sk-mphasis-demo-master-2024")
_HEADERS = {"Authorization": f"Bearer {_KEY}", "Content-Type": "application/json"}


def _url(path: str) -> str:
    return f"{_BASE}{path}"


def generate_virtual_key(
    alias: str,
    metadata: dict,
    models: list[str] | None = None,
    max_budget: float = 10.0,
    tpm_limit: int = 200_000,
) -> dict:
    """Issue a new LiteLLM virtual key. Returns the full response dict."""
    payload = {
        "key_alias": alias,
        "models": models or ["gemini-3.1-pro", "gemini-3-flash", "gemini-embedding"],
        "max_budget": max_budget,
        "tpm_limit": tpm_limit,
        "metadata": metadata,
    }
    r = httpx.post(_url("/key/generate"), json=payload, headers=_HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def delete_virtual_key(key: str) -> dict:
    """Revoke a LiteLLM virtual key."""
    r = httpx.post(_url("/key/delete"), json={"keys": [key]}, headers=_HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


def chat_completion(
    messages: list[dict],
    model: str = "gemini-3.1-pro",
    temperature: float = 1.0,
    reasoning_effort: str = "low",
) -> str:
    """Call LiteLLM chat completions (used by builder for code/spec generation)."""
    payload = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "reasoning_effort": reasoning_effort,
        "user": "system:builder-backend",
    }
    r = httpx.post(
        _url("/v1/chat/completions"),
        json=payload,
        headers=_HEADERS,
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]
