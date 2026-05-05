import logging
import os

import httpx

log = logging.getLogger(__name__)

_GITLAB_TIMEOUT = 30.0


class GitLabService:
    def __init__(self) -> None:
        self.base = os.environ.get("ATOM_GITLAB_URL", "https://gitlab.com").rstrip("/")
        self.group = os.environ.get("ATOM_GITLAB_GROUP", "")
        self.pat = os.environ.get("ATOM_GITLAB_PAT", "")
        self.runner_user = os.environ.get("ATOM_GITLAB_RUNNER_USER", "")
        self.headers = {"PRIVATE-TOKEN": self.pat}

    # ── Internal helpers ───────────────────────────────────────────────────────

    async def _group_id(self) -> int:
        """Return the numeric GitLab group ID for self.group."""
        last_segment = self.group.split("/")[-1] if self.group else ""
        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.get(
                f"{self.base}/api/v4/groups",
                headers=self.headers,
                params={"search": last_segment},
            )
            resp.raise_for_status()
            groups = resp.json()
            if not groups:
                raise RuntimeError(f"GitLab group not found: {self.group!r}")
            # Prefer exact full_path match
            for g in groups:
                if g.get("full_path") == self.group or g.get("path") == last_segment:
                    return int(g["id"])
            return int(groups[0]["id"])

    async def _user_id(self, username: str) -> int:
        """Return the numeric GitLab user ID for the given username."""
        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.get(
                f"{self.base}/api/v4/users",
                headers=self.headers,
                params={"username": username},
            )
            resp.raise_for_status()
            users = resp.json()
            if not users:
                raise RuntimeError(f"GitLab user not found: {username!r}")
            return int(users[0]["id"])

    # ── Public methods ─────────────────────────────────────────────────────────

    async def create_repo(self, agent_name: str) -> dict:
        """
        Create a new GitLab project under self.group.

        Returns dict with keys: id, web_url, http_url_to_repo.
        """
        group_id = await self._group_id()
        # Normalise agent name to a valid GitLab path
        slug = agent_name.lower().replace(" ", "-").replace("_", "-")

        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.post(
                f"{self.base}/api/v4/projects",
                headers=self.headers,
                json={
                    "name": agent_name,
                    "path": slug,
                    "namespace_id": group_id,
                    "visibility": "private",
                    "initialize_with_readme": False,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        return {
            "id": data["id"],
            "web_url": data["web_url"],
            "http_url_to_repo": data["http_url_to_repo"],
        }

    async def set_permissions(self, project_id: int) -> None:
        """Add runner_user as Maintainer (access_level=40) on the project."""
        if not self.runner_user:
            log.warning("gitlab: ATOM_GITLAB_RUNNER_USER not set — skipping permissions")
            return
        user_id = await self._user_id(self.runner_user)
        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.post(
                f"{self.base}/api/v4/projects/{project_id}/members",
                headers=self.headers,
                json={"user_id": user_id, "access_level": 40},
            )
            # 409 = already a member — treat as success
            if resp.status_code != 409:
                resp.raise_for_status()

    async def push_files(self, project_id: int, files: dict[str, str]) -> str:
        """
        Create a single commit with all files via the GitLab Commits API.

        files: mapping of {file_path: file_content}
        Returns the commit SHA.
        """
        actions = [
            {
                "action": "create",
                "file_path": path,
                "content": content,
            }
            for path, content in files.items()
        ]
        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.post(
                f"{self.base}/api/v4/projects/{project_id}/repository/commits",
                headers=self.headers,
                json={
                    "branch": "main",
                    "commit_message": "Initial agent scaffold [skip ci]",
                    "actions": actions,
                },
            )
            resp.raise_for_status()
            return resp.json()["id"]

    async def trigger_pipeline(self, project_id: int, commit_sha: str) -> dict:
        """
        Trigger a GitLab CI pipeline with ATOM_BUILD=true.

        Returns dict with keys: id, web_url.
        """
        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.post(
                f"{self.base}/api/v4/projects/{project_id}/pipeline",
                headers=self.headers,
                json={
                    "ref": "main",
                    "variables": [
                        {"key": "ATOM_BUILD", "value": "true"},
                        {"key": "ATOM_IMAGE_TAG", "value": commit_sha[:12]},
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
        return {"id": data["id"], "web_url": data.get("web_url", "")}

    async def pipeline_status(self, project_id: int, pipeline_id: int) -> str:
        """Return the current status string for the given pipeline."""
        async with httpx.AsyncClient(timeout=_GITLAB_TIMEOUT) as client:
            resp = await client.get(
                f"{self.base}/api/v4/projects/{project_id}/pipelines/{pipeline_id}",
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json().get("status", "unknown")
