"""
ReMe HTTP client for cross-conversation memory (personal + task kinds).
All public methods are async so generated agent code can await them.
All methods fail silently — memory is never on the critical path.
"""

import httpx


class ReMeClient:
    def __init__(self, base_url: str, actor_id: str):
        self.base_url = base_url.rstrip("/")
        self.actor_id = actor_id

    # ------------------------------------------------------------------
    # Personal memory — accepts workspace_id or user_id (alias)
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
            return r.json().get("results", []) if r.is_success else []
        except Exception:
            return []

    async def record_personal(
        self, workspace_id: str = "", user_id: str = "", content: str = ""
    ) -> None:
        wid = workspace_id or user_id
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{self.base_url}/summary_personal_memory",
                    json={"query": content, "workspace_id": wid, "metadata": {"actor_id": self.actor_id}},
                )
        except Exception:
            pass

    # Alias so generated code can use either name
    write_personal = record_personal

    # ------------------------------------------------------------------
    # Task memory — keyed by task type ("asset-recon-patterns" etc.)
    # ------------------------------------------------------------------

    async def retrieve_task(self, workspace_id: str = "", task_key: str = "", query: str = "") -> list[dict]:
        workspace_id = workspace_id or task_key
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                r = await client.post(
                    f"{self.base_url}/retrieve_task_memory",
                    json={"query": query, "workspace_id": workspace_id, "metadata": {"actor_id": self.actor_id}},
                )
            return r.json().get("results", []) if r.is_success else []
        except Exception:
            return []

    async def record_task(self, workspace_id: str = "", task_key: str = "", content: str = "") -> None:
        workspace_id = workspace_id or task_key
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                await client.post(
                    f"{self.base_url}/record_task_memory",
                    json={
                        "workspace_id": workspace_id,
                        "memory_dicts": [{"content": content}],
                        "update_utility": False,
                        "metadata": {"actor_id": self.actor_id},
                    },
                )
        except Exception:
            pass

    write_task = record_task
