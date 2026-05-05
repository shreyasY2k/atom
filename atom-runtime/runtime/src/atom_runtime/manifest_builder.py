"""
Builds Kubernetes manifests for agent pods.

Every agent gets four resources in the `atom-agents` namespace:
  - Secret         agent-jwt-{agent_id}   — ATOM_AGENT_JWT
  - Deployment     agent-{agent_id}       — 1 replica, readiness probe /healthz
  - Service        agent-{agent_id}       — ClusterIP :8080
  - NetworkPolicy  agent-{agent_id}-ingress — ingress only from GATE pods
"""

from kubernetes import client as k8s


# ── Name helpers ──────────────────────────────────────────────────────────────


def resource_name(agent_id: str) -> str:
    return f"agent-{agent_id}"


def jwt_secret_name(agent_id: str) -> str:
    return f"agent-jwt-{agent_id}"


def cluster_service_dns(agent_id: str, namespace: str) -> str:
    return f"agent-{agent_id}.{namespace}.svc.cluster.local"


# ── Resource builders ─────────────────────────────────────────────────────────


def build_jwt_secret(
    agent_id: str,
    agent_jwt: str,
    namespace: str,
) -> k8s.V1Secret:
    return k8s.V1Secret(
        api_version="v1",
        kind="Secret",
        metadata=k8s.V1ObjectMeta(
            name=jwt_secret_name(agent_id),
            namespace=namespace,
            labels={
                "atom.io/agent-id": agent_id,
                "atom.io/managed-by": "atom-runtime",
            },
        ),
        type="Opaque",
        string_data={"ATOM_AGENT_JWT": agent_jwt},
    )


def build_deployment(
    agent_id: str,
    domain_id: str,
    deployment_id: str,
    image: str,
    gate_url: str,
    namespace: str,
    cpu_request: str = "100m",
    cpu_limit: str = "500m",
    mem_request: str = "256Mi",
    mem_limit: str = "512Mi",
    image_pull_secret: str | None = None,
) -> k8s.V1Deployment:
    name = resource_name(agent_id)
    pod_labels = {
        "app": "agent",
        "atom.io/agent-id": agent_id,
        "atom.io/domain-id": domain_id,
        "atom.io/deployment-id": deployment_id,
    }
    return k8s.V1Deployment(
        api_version="apps/v1",
        kind="Deployment",
        metadata=k8s.V1ObjectMeta(
            name=name,
            namespace=namespace,
            labels=pod_labels,
            annotations={"atom.io/deployment-id": deployment_id},
        ),
        spec=k8s.V1DeploymentSpec(
            replicas=1,
            selector=k8s.V1LabelSelector(
                match_labels={"atom.io/agent-id": agent_id},
            ),
            template=k8s.V1PodTemplateSpec(
                metadata=k8s.V1ObjectMeta(labels=pod_labels),
                spec=k8s.V1PodSpec(
                    security_context=k8s.V1PodSecurityContext(
                        run_as_non_root=True,
                        run_as_user=1000,
                    ),
                    image_pull_secrets=(
                        [k8s.V1LocalObjectReference(name=image_pull_secret)]
                        if image_pull_secret
                        else None
                    ),
                    containers=[
                        k8s.V1Container(
                            name="agent",
                            image=image,
                            image_pull_policy="IfNotPresent",
                            ports=[k8s.V1ContainerPort(container_port=8080, name="http")],
                            env=[
                                k8s.V1EnvVar(
                                    name="ATOM_AGENT_JWT",
                                    value_from=k8s.V1EnvVarSource(
                                        secret_key_ref=k8s.V1SecretKeySelector(
                                            name=jwt_secret_name(agent_id),
                                            key="ATOM_AGENT_JWT",
                                        )
                                    ),
                                ),
                                k8s.V1EnvVar(name="ATOM_GATE_URL", value=gate_url),
                                k8s.V1EnvVar(name="ATOM_AGENT_ID", value=agent_id),
                                k8s.V1EnvVar(name="ATOM_DOMAIN_ID", value=domain_id),
                            ],
                            resources=k8s.V1ResourceRequirements(
                                requests={"cpu": cpu_request, "memory": mem_request},
                                limits={"cpu": cpu_limit, "memory": mem_limit},
                            ),
                            readiness_probe=k8s.V1Probe(
                                http_get=k8s.V1HTTPGetAction(
                                    path="/healthz",
                                    port=8080,
                                ),
                                initial_delay_seconds=5,
                                period_seconds=5,
                                failure_threshold=12,
                            ),
                        )
                    ],
                ),
            ),
        ),
    )


def build_service(agent_id: str, namespace: str) -> k8s.V1Service:
    name = resource_name(agent_id)
    return k8s.V1Service(
        api_version="v1",
        kind="Service",
        metadata=k8s.V1ObjectMeta(
            name=name,
            namespace=namespace,
            labels={
                "atom.io/agent-id": agent_id,
                "atom.io/managed-by": "atom-runtime",
            },
        ),
        spec=k8s.V1ServiceSpec(
            type="ClusterIP",
            selector={"atom.io/agent-id": agent_id},
            ports=[
                k8s.V1ServicePort(
                    port=8080,
                    target_port=8080,
                    protocol="TCP",
                    name="http",
                )
            ],
        ),
    )


def build_network_policy(
    agent_id: str,
    namespace: str,
    gate_namespace: str,
) -> dict:
    """
    Returns a NetworkPolicy as a plain dict so we can apply it with the
    dynamic client (NetworkingV1Api only exposes typed objects, but
    passing a dict body is accepted).
    """
    name = resource_name(agent_id)
    return {
        "apiVersion": "networking.k8s.io/v1",
        "kind": "NetworkPolicy",
        "metadata": {
            "name": f"{name}-ingress",
            "namespace": namespace,
            "labels": {
                "atom.io/agent-id": agent_id,
                "atom.io/managed-by": "atom-runtime",
            },
        },
        "spec": {
            "podSelector": {"matchLabels": {"atom.io/agent-id": agent_id}},
            "policyTypes": ["Ingress"],
            "ingress": [
                {
                    "from": [
                        {
                            "namespaceSelector": {
                                "matchLabels": {"kubernetes.io/metadata.name": gate_namespace}
                            },
                            "podSelector": {"matchLabels": {"app": "gate"}},
                        }
                    ],
                    "ports": [{"protocol": "TCP", "port": 8080}],
                }
            ],
        },
    }
