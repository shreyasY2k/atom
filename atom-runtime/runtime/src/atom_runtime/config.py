from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    atom_studio_api_url: str = "http://localhost:3001"

    # URL atom-runtime advertises to atom-studio on startup (how studio calls back)
    atom_runtime_self_url: str = "http://localhost:8090"

    # GATE URL injected as ATOM_GATE_URL into every deployed agent pod.
    # In kind (macOS Docker Desktop) host.docker.internal reaches the docker-compose GATE.
    atom_gate_cluster_url: str = "http://host.docker.internal:8080"

    agent_namespace: str = "atom-agents"
    gate_namespace: str = "atom-system"

    runtime_port: int = 8090

    # How long to wait for a pod to become Ready before marking the deployment failed
    pod_ready_timeout_s: int = 120
    pod_poll_interval_s: int = 5

    # Path to kubeconfig; None = auto-detect (in-cluster if running as a pod, else ~/.kube/config)
    kubeconfig: str | None = None

    # Backend: "k8s" (default) or "docker" (docker-compose dev — runs agents as containers)
    runtime_backend: str = "k8s"

    # Docker-backend settings (only used when runtime_backend="docker")
    docker_network: str = "atom-dev_default"
    docker_agent_gate_url: str = "http://gate:8080"

    # GitLab Container Registry credentials for pulling private agent images.
    # Set GITLAB_REGISTRY_TOKEN to the PAT (scope: read_registry).
    # Used by docker backend to pre-authenticate before pulling; used by k8s backend
    # to create an imagePullSecret reference in agent Deployments.
    gitlab_registry_url: str = "registry.gitlab.com"
    gitlab_registry_user: str = "oauth2"
    gitlab_registry_token: str = ""  # PAT with read_registry scope

    # k8s: name of the docker-registry Secret in atom-agents namespace that agents
    # use as imagePullSecrets. Created via `make k8s-registry-secret`.
    image_pull_secret_name: str = ""  # e.g. "gitlab-registry-secret"


@lru_cache
def get_settings() -> Settings:
    return Settings()
