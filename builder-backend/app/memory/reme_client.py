"""
ReMe HTTP client for cross-conversation memory (personal + task kinds).
All public methods are async so generated agent code can await them.
All methods fail silently — memory is never on the critical path.

Endpoint notes (ReMe v0.3.1.8):
  - retrieve_personal_memory / retrieve_task_memory  → vector recall, returns results[]
  - record_task_memory                               → direct memory_dicts storage (works for both kinds)
  - summary_personal_memory / summary_task_memory    → trajectory-based LLM extraction (NOT suitable
    for plain text strings — use record_task_memory for direct writes instead)
"""

import httpx


class ReMeClient:
    def __init__(self, base_url: str, actor_id: str):
        self.base_url = base_url.rstrip("/")
        self.actor_id = actor_id

    # ------------------------------------------------------------------
    # Personal memory — namespaced by user/customer identity
    # ------------------------------------------------------------------

    async def retrieve_personal(
        self, workspace_id: str = "", user_id: str = "", query: str = ""
    ) -> list[dict]:
        wid = workspace_id or user_id
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(
                    f"{self.base_url}/retrieve_personal_memory",
                    json={"query": query, "workspace_id": wid, "metadata": {"actor_id": self.actor_id}},
                )
            data = r.json() if r.is_success else {}
            # ReMe returns results under metadata.memory_list or directly as results[]
            return (
                data.get("results")
                or data.get("metadata", {}).get("memory_list", [])
                or []
            )
        except Exception:
            return []

    async def record_personal(
        self, workspace_id: str = "", user_id: str = "", content: str = ""
    ) -> None:
        # summary_personal_memory_simple uses SimpleSummaryOp which stores plain strings.
        # The trajectory-based summary_personal_memory requires structured conversation data.
        wid = workspace_id or user_id
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{self.base_url}/summary_personal_memory_simple",
                    json={
                        "trajectories": [{"content": content, "score": 1.0}],
                        "workspace_id": wid,
                        "metadata": {"actor_id": self.actor_id},
                    },
                )
        except Exception:
            pass

    # Alias so generated code can use either name
    write_personal = record_personal

    # ------------------------------------------------------------------
    # Task memory — keyed by task type ("asset-recon-patterns" etc.)
    # ------------------------------------------------------------------

    async def retrieve_task(self, workspace_id: str = "", task_key: str = "", query: str = "") -> list[dict]:
        wid = workspace_id or task_key
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(
                    f"{self.base_url}/retrieve_task_memory",
                    json={"query": query, "workspace_id": wid, "metadata": {"actor_id": self.actor_id}},
                )
            data = r.json() if r.is_success else {}
            return (
                data.get("results")
                or data.get("metadata", {}).get("memory_list", [])
                or []
            )
        except Exception:
            return []

    async def record_task(self, workspace_id: str = "", task_key: str = "", content: str = "") -> None:
        # summary_task_memory_simple uses SimpleSummaryOp — stores plain text directly.
        wid = workspace_id or task_key
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{self.base_url}/summary_task_memory_simple",
                    json={
                        "trajectories": [{"content": content, "score": 1.0}],
                        "workspace_id": wid,
                        "metadata": {"actor_id": self.actor_id},
                    },
                )
        except Exception:
            pass

    write_task = record_task
