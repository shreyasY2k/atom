"""GitLab CI driver for building agent container images.

Used by container.py when AGENT_BUILD_MODE=gitlab.

Flow:
  1. Commit the agent build context (agent.py, Dockerfile, requirements) to the
     GitLab repo under agent-builds/<name>-<version>/ via the Commits API.
     Shared files (tools/, memory/, agent-roles/, packages/) live in the repo
     root and are referenced directly by the Dockerfile — no copy needed.
  2. Trigger a CI pipeline on the configured branch with BUILD_TYPE=agent.
  3. Poll until the pipeline succeeds (or fail fast on failure/cancellation).
  4. Return the full registry image reference so docker-py can pull and run it.

Required environment variables (never hardcode values here):
  GITLAB_URL              e.g. https://gitlab.com
  GITLAB_PROJECT_ID       numeric project ID shown in project Settings → General
  GITLAB_ACCESS_TOKEN     personal / project / deploy token with api + write_repository scopes
  GITLAB_TRIGGER_TOKEN    pipeline trigger token (Settings → CI/CD → Pipeline triggers)
  ATOM_REGISTRY_IMAGE     full registry image prefix, e.g. registry.gitlab.com/org/atom
  GITLAB_REGISTRY_USER    user for docker pull (often "gitlab-ci-token" or deploy token name)
  GITLAB_REGISTRY_PASSWORD  password / token value for docker pull

Optional:
  GITLAB_CI_BRANCH        branch to commit to and trigger on (default: production)
  GITLAB_BUILD_TIMEOUT    seconds to wait for pipeline (default: 600)
"""

import base64
import os
import time
import textwrap

import httpx


# ── Helpers ───────────────────────────────────────────────────────────────────

def _api(path: str) -> str:
    base = os.environ["GITLAB_URL"].rstrip("/")
    pid = os.environ["GITLAB_PROJECT_ID"]
    return f"{base}/api/v4/projects/{pid}/{path}"


def _token_headers() -> dict:
    return {"PRIVATE-TOKEN": os.environ["GITLAB_ACCESS_TOKEN"]}


def _branch() -> str:
    return os.environ.get("GITLAB_CI_BRANCH", "production")


# ── Step 1: commit build context ──────────────────────────────────────────────

def _commit_build_context(name: str, version: str, files: dict[str, str]) -> None:
    """Atomically commit all build context files in one GitLab API call."""
    actions = []
    for rel_path, content in files.items():
        encoded = base64.b64encode(content.encode()).decode()
        actions.append({
            "action": "create",
            "file_path": f"agent-builds/{name}-{version}/{rel_path}",
            "content": encoded,
            "encoding": "base64",
        })

    payload = {
        "branch": _branch(),
        "commit_message": f"build: agent {name} {version}",
        "actions": actions,
    }

    with httpx.Client(timeout=30) as client:
        r = client.post(_api("repository/commits"), headers=_token_headers(), json=payload)
        if r.status_code in (400, 422) and "already exists" in r.text.lower():
            # Files exist from a previous build — update instead
            for a in actions:
                a["action"] = "update"
            r = client.post(_api("repository/commits"), headers=_token_headers(), json=payload)
        r.raise_for_status()


# ── Step 2: trigger pipeline ──────────────────────────────────────────────────

def _trigger_pipeline(name: str, version: str) -> int:
    """POST to the trigger endpoint. Returns the new pipeline ID."""
    with httpx.Client(timeout=30) as client:
        r = client.post(
            _api("trigger/pipeline"),
            data={
                "token": os.environ["GITLAB_TRIGGER_TOKEN"],
                "ref": _branch(),
                "variables[BUILD_TYPE]": "agent",
                "variables[AGENT_NAME]": name,
                "variables[AGENT_VERSION]": version,
            },
        )
        r.raise_for_status()
        return r.json()["id"]


# ── Step 3: poll ──────────────────────────────────────────────────────────────

_TERMINAL_STATUSES = {"success", "failed", "canceled", "skipped"}


def _poll_pipeline(pipeline_id: int) -> None:
    timeout = int(os.environ.get("GITLAB_BUILD_TIMEOUT", "600"))
    deadline = time.time() + timeout
    with httpx.Client(timeout=30) as client:
        while time.time() < deadline:
            r = client.get(_api(f"pipelines/{pipeline_id}"), headers=_token_headers())
            r.raise_for_status()
            status = r.json()["status"]
            if status == "success":
                return
            if status in _TERMINAL_STATUSES:
                raise RuntimeError(
                    f"GitLab pipeline {pipeline_id} ended with status={status}. "
                    f"Check {os.environ['GITLAB_URL']} for logs."
                )
            time.sleep(10)
    raise TimeoutError(
        f"GitLab pipeline {pipeline_id} did not finish within {timeout}s."
    )


# ── Dockerfile template for CI builds ────────────────────────────────────────

def _ci_dockerfile(name: str, version: str, agent_port: int) -> str:
    """Generate a Dockerfile that references shared repo files via COPY paths.

    The Kaniko build context in CI is the full project dir, so COPY paths are
    relative to the repo root. RUNTIME_IMAGE is injected as a build-arg so the
    registry URL is never hardcoded here.
    """
    return textwrap.dedent(f"""
        ARG RUNTIME_IMAGE
        FROM ${{RUNTIME_IMAGE}}

        WORKDIR /app

        COPY agent-builds/{name}-{version}/requirements-agent.txt requirements.txt
        RUN pip install --no-cache-dir -r requirements.txt

        COPY builder-backend/app/tools/ tools/
        COPY builder-backend/app/memory/ memory/
        COPY skills/ skills/
        COPY agent-roles/ agent-roles/
        COPY packages/agentscope_skills/ agentscope_skills/
        RUN pip install --no-cache-dir ./agentscope_skills/

        COPY agent-builds/{name}-{version}/agent.py agent.py

        EXPOSE {agent_port}
        CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "{agent_port}"]
    """).strip()


# ── Public API ────────────────────────────────────────────────────────────────

def build_agent_image(
    name: str,
    version: str,
    agent_code: str,
    requirements: str,
    agent_port: int,
) -> str:
    """Build an agent image via GitLab CI and return the full image reference.

    Blocks until the pipeline finishes (success) or raises on failure/timeout.
    """
    dockerfile = _ci_dockerfile(name, version, agent_port)

    _commit_build_context(name, version, {
        "agent.py": agent_code,
        "requirements-agent.txt": requirements,
        "Dockerfile": dockerfile,
    })

    pipeline_id = _trigger_pipeline(name, version)
    _poll_pipeline(pipeline_id)

    registry_image = os.environ["ATOM_REGISTRY_IMAGE"]
    return f"{registry_image}/agents/{name}:{version}"


def pull_agent_image(image_ref: str) -> None:
    """Pull the built image from the GitLab registry into the local Docker daemon.

    Reads credentials from GITLAB_REGISTRY_USER / GITLAB_REGISTRY_PASSWORD.
    If credentials are absent the pull is attempted without auth (useful if the
    daemon already has credentials cached).
    """
    import docker  # imported lazily — not needed at module load time

    dc = docker.from_env()
    reg_user = os.environ.get("GITLAB_REGISTRY_USER", "")
    reg_pass = os.environ.get("GITLAB_REGISTRY_PASSWORD", "")
    registry = os.environ.get("ATOM_REGISTRY_IMAGE", "").split("/")[0]

    if reg_user and reg_pass and registry:
        dc.login(registry=registry, username=reg_user, password=reg_pass)

    dc.images.pull(image_ref)
