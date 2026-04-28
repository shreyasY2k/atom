"""
Kubernetes client setup.

Detects whether we're running inside a pod (uses in-cluster config) or
outside the cluster (uses kubeconfig). Falls back gracefully for tests.
"""

from kubernetes import client as k8s, config as k8s_config

from .config import get_settings

_loaded = False


def _load_config() -> None:
    global _loaded
    if _loaded:
        return
    settings = get_settings()
    try:
        k8s_config.load_incluster_config()
    except k8s_config.ConfigException:
        k8s_config.load_kube_config(config_file=settings.kubeconfig)
    _loaded = True


def get_k8s_clients() -> tuple[k8s.AppsV1Api, k8s.CoreV1Api, k8s.NetworkingV1Api]:
    _load_config()
    return (
        k8s.AppsV1Api(),
        k8s.CoreV1Api(),
        k8s.NetworkingV1Api(),
    )
