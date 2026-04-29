"""
atom-runtime Docker backend.

Runs agent containers directly on the local Docker daemon instead of k8s.
Used when RUNTIME_BACKEND=docker (docker-compose dev environment).

Each agent maps to a single Docker container:
  name:    agent-{agent_id}
  network: DOCKER_NETWORK (atom-dev_default by default)
  labels:  atom.io/agent-id={agent_id}

The container hostname on the Docker network becomes the cluster_service_name
stored in Postgres: "agent-{agent_id}:8080". GATE resolves this via the same
Redis/Postgres lookup and proxies requests to http://agent-{agent_id}:8080.
"""

import asyncio
import logging

import docker
import docker.errors
from docker.models.containers import Container

logger = logging.getLogger(__name__)

_AGENT_PORT = 8080
_HEALTH_PATH = "/healthz"
_POLL_INTERVAL = 3
_POLL_TIMEOUT = 60


def _client() -> docker.DockerClient:
    return docker.from_env()


def container_name(agent_id: str) -> str:
    return f"agent-{agent_id}"


def service_address(agent_id: str) -> str:
    """Address stored in cluster_service_name; GATE builds http://<addr>/..."""
    return f"{container_name(agent_id)}:{_AGENT_PORT}"


def _remove_existing(client: docker.DockerClient, name: str) -> None:
    try:
        c = client.containers.get(name)
        logger.info("Removing existing container %s", name)
        c.stop(timeout=5)
        c.remove()
    except docker.errors.NotFound:
        pass


def _run_container(
    client: docker.DockerClient,
    agent_id: str,
    domain_id: str,
    image: str,
    agent_jwt: str,
    gate_url: str,
    network: str,
) -> Container:
    name = container_name(agent_id)
    _remove_existing(client, name)

    logger.info("Starting container %s from image %s on network %s", name, image, network)
    import os as _os  # noqa: PLC0415

    env = {
        "ATOM_AGENT_JWT": agent_jwt,
        "ATOM_AGENT_ID": agent_id,
        "ATOM_DOMAIN_ID": domain_id,
        "ATOM_GATE_URL": gate_url,
    }
    # Forward Kafka brokers so the agent can stream logs to atom.agent.logs
    if kb := _os.environ.get("KAFKA_BROKERS"):
        env["KAFKA_BROKERS"] = kb
    # Studio URL so the agent can record conversation runs
    env["ATOM_STUDIO_URL"] = _os.environ.get("ATOM_STUDIO_API_URL", "http://atom-studio-api:3001")

    container = client.containers.run(
        image,
        name=name,
        detach=True,
        network=network,
        environment=env,
        labels={
            "atom.io/agent-id": agent_id,
            "atom.io/domain-id": domain_id,
            "com.docker.compose.project": "atom-dev",
        },
        restart_policy={"Name": "unless-stopped"},
    )
    return container


async def _poll_healthy(agent_id: str, timeout: int = _POLL_TIMEOUT) -> bool:
    import httpx

    url = f"http://{service_address(agent_id)}{_HEALTH_PATH}"
    elapsed = 0
    while elapsed < timeout:
        try:
            async with httpx.AsyncClient(timeout=2) as c:
                r = await c.get(url)
                if r.status_code < 400:
                    logger.info("Container agent-%s is healthy", agent_id)
                    return True
        except Exception:
            pass
        await asyncio.sleep(_POLL_INTERVAL)
        elapsed += _POLL_INTERVAL

    # Fallback: check container is at least running
    try:
        c = _client().containers.get(container_name(agent_id))
        if c.status == "running":
            logger.info("Container agent-%s is running (no /healthz)", agent_id)
            return True
    except Exception:
        pass
    return False


async def deploy(
    agent_id: str,
    domain_id: str,
    image: str,
    agent_jwt: str,
    gate_url: str,
    network: str,
) -> tuple[bool, str]:
    """
    Run the agent container and wait for it to become healthy.
    Returns (success, service_address).
    """
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: _run_container(
                _client(), agent_id, domain_id, image, agent_jwt, gate_url, network
            ),
        )
    except docker.errors.ImageNotFound:
        return False, f"Image {image!r} not found — pull it first"
    except Exception as exc:
        return False, str(exc)

    ready = await _poll_healthy(agent_id)
    return ready, service_address(agent_id)


async def rollback(
    agent_id: str, prev_image: str, domain_id: str, agent_jwt: str, gate_url: str, network: str
) -> bool:
    loop = asyncio.get_event_loop()
    try:
        await loop.run_in_executor(
            None,
            lambda: _run_container(
                _client(), agent_id, domain_id, prev_image, agent_jwt, gate_url, network
            ),
        )
        return True
    except Exception as exc:
        logger.error("Docker rollback for agent %s failed: %s", agent_id, exc)
        return False


def remove(agent_id: str) -> None:
    _remove_existing(_client(), container_name(agent_id))
