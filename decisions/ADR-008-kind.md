# ADR-008 — kind for Local Kubernetes

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

Every ATOM component eventually runs in Kubernetes (agents are k8s pods, GATE and services are
k8s Deployments). Developers need a local k8s cluster that matches production closely enough to
catch integration bugs early.

The team confirmed they have a local kind cluster already running.

## Decision

Use **kind (Kubernetes in Docker)** as the local development cluster.

kind config is checked into `infra/kind/cluster.yaml`. It defines:
- 1 control plane node
- 2 worker nodes (to simulate pod scheduling)
- Port mappings for GATE (80/443), atom-studio (3000), Grafana (3001), MinIO console (9001)
- Extra mounts for persistent storage in dev

## Rationale

- kind runs entirely inside Docker — no VM, no hypervisor, no cloud account.
- Multi-node config exercises pod scheduling and affinity rules that matter for BFSI HA setups.
- Easily scripted: `kind create cluster --config infra/kind/cluster.yaml` is one command.
- Widely used in CI (kind is the standard for running k8s integration tests in GitHub Actions).
- `kubectl`, `helm`, and all standard tooling work unchanged against kind.

## Consequences

- **Positive:** Zero cost, reproducible, scriptable, CI-compatible.
- **Negative:** Node resources are Docker containers sharing host RAM/CPU; performance is
  lower than bare-metal. Not a concern for development iteration. Production targets bare-metal
  or managed k8s (EKS/AKS) — kind config is the specification; Helm values handle environment
  differences.

## Upgrade Path

When moving to production, swap kind for the actual cluster. All Helm charts and manifests in
`infra/` are parameterised via `values-prod.yaml` overrides.

---

