"""
Docker lifecycle for deployed agent containers.

Each agent runs as a container named agent-{name}-{version-slug}
on the atom_agentnet network.
Build context is created in /work/agents/{name}-{version}/

Deployment is managed through LocalDeployManager, a thin facade over docker-py
that matches the interface AgentScope Runtime's deployer API will expose in
Phase 2 (Kubernetes/Kruise variant).
"""

import hashlib
import os
import shutil
import textwrap
import time
from pathlib import Path

import docker
from docker.errors import DockerException, NotFound

WORK_DIR = Path(os.environ.get("WORK_DIR", "/work"))
AGENT_PORT = 8100
DOCKER_NETWORK = "atom_agentnet"
STUDIO_URL = os.environ.get("STUDIO_URL", "http://studio:3000")


def _client():
    return docker.from_env()


def _container_name(name: str, version: str) -> str:
    slug = version.replace(".", "-")
    return f"agent-{name}-{slug}"


def _build_dir(name: str, version: str) -> Path:
    return WORK_DIR / "agents" / f"{name}-{version}"


def _agent_dockerfile(name: str, version: str) -> str:
    return textwrap.dedent(f"""
        FROM atom-runtime-sandbox
        WORKDIR /app
        COPY requirements-agent.txt requirements.txt
        RUN pip install --no-cache-dir -r requirements.txt
        COPY tools/ tools/
        COPY memory/ memory/
        COPY skills/ skills/
        COPY agent-roles/ agent-roles/
        COPY agentscope_skills/ agentscope_skills/
        RUN pip install --no-cache-dir ./agentscope_skills/
        COPY agent.py .
        EXPOSE {AGENT_PORT}
        CMD ["uvicorn", "agent:app", "--host", "0.0.0.0", "--port", "{AGENT_PORT}"]
    """).strip()


def _agent_requirements() -> str:
    return "fastapi==0.115.0\nuvicorn[standard]==0.30.6\nhttpx==0.27.2\n"


_SKILLS_PATH = Path(os.environ.get("SKILLS_PATH", "/app/skills"))


def _copy_support_files(build_path: Path) -> None:
    """Copy tools, memory, and skills into the build context."""
    src_root = Path(__file__).parent.parent

    tools_dst = build_path / "tools"
    tools_dst.mkdir(exist_ok=True)
    (tools_dst / "__init__.py").write_text("")
    shutil.copy2(src_root / "tools" / "registry.py", tools_dst / "registry.py")

    mem_dst = build_path / "memory"
    mem_dst.mkdir(exist_ok=True)
    (mem_dst / "__init__.py").write_text("")
    shutil.copy2(src_root / "memory" / "reme_client.py", mem_dst / "reme_client.py")

    # Copy skill files (legacy) so generated code can load them at runtime
    if _SKILLS_PATH.exists():
        dst_skills = build_path / "skills"
        if dst_skills.exists():
            shutil.rmtree(dst_skills)
        shutil.copytree(str(_SKILLS_PATH), str(dst_skills))

    # Copy agent-roles/ directory (new canonical location)
    _agent_roles_path = Path(os.environ.get("AGENT_ROLES_PATH", "/app/agent-roles"))
    if _agent_roles_path.exists():
        dst_roles = build_path / "agent-roles"
        if dst_roles.exists():
            shutil.rmtree(dst_roles)
        shutil.copytree(str(_agent_roles_path), str(dst_roles))

    # Copy agentscope_skills package so agent containers can install it
    _skills_pkg_path = Path(os.environ.get("AGENTSCOPE_SKILLS_PATH", "/app/packages/agentscope_skills"))
    if _skills_pkg_path.exists():
        dst_pkg = build_path / "agentscope_skills"
        if dst_pkg.exists():
            shutil.rmtree(dst_pkg)
        shutil.copytree(str(_skills_pkg_path), str(dst_pkg))


def build_and_run(
    name: str,
    version: str,
    agent_code: str,
    env_vars: dict,
) -> str:
    """
    Build the agent image and start the container.

    Returns the container endpoint URL (accessible on agentnet):
      http://agent-{name}-{version-slug}:{AGENT_PORT}
    """
    dc = _client()
    cname = _container_name(name, version)
    build_path = _build_dir(name, version)

    # Clean up any existing container with this name
    _stop_container(dc, cname)

    # Prepare build context
    build_path.mkdir(parents=True, exist_ok=True)
    (build_path / "agent.py").write_text(agent_code)
    (build_path / "Dockerfile").write_text(_agent_dockerfile(name, version))
    (build_path / "requirements-agent.txt").write_text(_agent_requirements())
    _copy_support_files(build_path)

    image_tag = f"agent-{name}:{version}"

    # Build image
    dc.images.build(path=str(build_path), tag=image_tag, rm=True)

    # Run container
    container = dc.containers.run(
        image_tag,
        name=cname,
        detach=True,
        network=DOCKER_NETWORK,
        environment=env_vars,
        restart_policy={"Name": "unless-stopped"},
    )

    # Wait up to 20 s for the container to be running
    for _ in range(20):
        container.reload()
        if container.status == "running":
            break
        time.sleep(1)

    endpoint = f"http://{cname}:{AGENT_PORT}"
    return endpoint


def stop_and_remove(name: str, version: str) -> None:
    """Stop and remove the agent container."""
    dc = _client()
    cname = _container_name(name, version)
    _stop_container(dc, cname)


def _stop_container(dc, cname: str) -> None:
    try:
        c = dc.containers.get(cname)
        c.stop(timeout=5)
        c.remove()
    except NotFound:
        pass
    except DockerException:
        pass


def container_healthy(endpoint: str) -> bool:
    """Quick health-check on the deployed container."""
    import httpx
    try:
        r = httpx.get(f"{endpoint}/health", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


class LocalDeployManager:
    """Facade over docker-py that matches the AgentScope Runtime deployer interface.

    Phase 1: wraps build_and_run() (docker-py).
    Phase 2: replace internals with KubernetesDeployManager / KruiseDeployManager.

    Usage matches what agentscope_runtime.engine.deployers.LocalDeployManager
    will expose once the package publishes a stable API:

        mgr = LocalDeployManager(workdir=f"/tmp/deployments/{spec.name}")
        result = await mgr.deploy(agent_module="agent", port=8100, env={...})
        # result["endpoint"] → "http://agent-<name>-<version>:8100"
    """

    def __init__(self, workdir: str):
        self.workdir = workdir

    def deploy(
        self,
        *,
        name: str,
        version: str,
        agent_code: str,
        port: int,
        env: dict,
    ) -> dict:
        """Build and run the agent container.  Returns deployment metadata."""
        endpoint = build_and_run(name=name, version=version, agent_code=agent_code, env_vars=env)
        return {"endpoint": endpoint, "port": port, "status": "running"}

    def undeploy(self, *, name: str, version: str) -> None:
        """Stop and remove the agent container."""
        stop_and_remove(name=name, version=version)
