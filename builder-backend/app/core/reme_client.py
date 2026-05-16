"""ReMe (long-term memory) client — retrieve and summarise task memories."""

import os

import httpx

REME_URL = os.environ.get("REME_URL", "http://reme:8002")
_TIMEOUT = 15


def retrieve(query: str, workspace_id: str, top_k: int = 5) -> list[dict]:
    """Retrieve top-K long-term memories for a query + workspace (entity ID)."""
    try:
        resp = httpx.post(
            f"{REME_URL}/retrieve_task_memory_simple",
            json={"query": query, "workspace_id": workspace_id},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        meta = data.get("metadata") or {}
        # ReMe v0.3.x returns {"success": true, "metadata": {"memory_list": [...]}}
        memories = meta.get("memory_list") or data.get("memories") or data.get("result") or []
        if isinstance(memories, list):
            return memories[:top_k]
        return []
    except Exception:
        return []


def summarise(content: str, workspace_id: str) -> bool:
    """Write a conversation summary to long-term memory. Fire-and-forget."""
    try:
        # ReMe SimpleSummaryOp takes trajectories as list of text strings.
        resp = httpx.post(
            f"{REME_URL}/summary_task_memory_simple",
            json={"trajectories": [content], "workspace_id": workspace_id},
            timeout=_TIMEOUT,
        )
        return resp.status_code < 300
    except Exception:
        return False


def format_memories_as_context(memories: list[dict]) -> str:
    """Convert retrieved memories to a system-prompt context block."""
    if not memories:
        return ""
    lines = ["## Relevant memory from past sessions\n"]
    for m in memories:
        text = m.get("content") or m.get("memory") or m.get("text") or str(m)
        lines.append(f"- {text}")
    return "\n".join(lines)
