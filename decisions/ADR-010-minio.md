# ADR-010 — MinIO for Object Storage

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

ATOM needs object storage for:
- Long-term audit log archive (from Kafka consumers).
- LiteLLM audit log export (LiteLLM natively supports S3-compatible sinks).
- Agent output artefacts.
- OPA policy bundles (optionally).

## Decision

Use **MinIO** deployed in the kind cluster and in production.

LiteLLM's existing S3 audit log sink is pointed at MinIO. The log-archiver service uses the
`aws-sdk-go-v2` S3 client (configured for MinIO endpoint) to write Parquet files.

## Rationale

- S3-compatible API means LiteLLM works without modification.
- Self-hosted (data sovereignty — critical for BFSI).
- Excellent Kubernetes operator and Helm chart.
- MinIO supports object versioning and lifecycle policies (automatic expiry after N years).
- Standard AWS SDK clients work unchanged (just set `endpoint_url`).

## Consequences

- **Positive:** Data stays on-premises; S3-compatible; proven at scale.
- **Negative:** Another stateful service. Persistent volume management in kind requires
  care (use `local-path-provisioner` or `hostPath`).

---

