# ADR-009 — Kafka (Redpanda) for Log Streaming

**Status:** Accepted  
**Date:** 2025-01-01

---

## Context

All ATOM services (GATE, atom-llm, atom-studio, agents) must forward logs and events to a
central streaming bus for:
- Real-time log viewing in atom-studio.
- Archival to MinIO for long-term BFSI compliance storage.
- Future consumers (alerting, anomaly detection, compliance reporting).

## Decision

Use **Redpanda** as the Kafka-compatible event streaming platform.

All services produce to named topics:
- `atom.audit` — GATE audit chain events (mirrors the Postgres hash chain)
- `atom.llm` — LiteLLM request/response audit records
- `atom.agent.logs` — agent stdout/stderr from k8s pods
- `atom.deployments` — deployment lifecycle events

A single **log-archiver** service (Go) consumes all topics and writes rotated parquet files to
MinIO under `s3://atom-audit/{year}/{month}/{day}/{topic}/`.

## Why Redpanda over Apache Kafka

- Redpanda is Kafka API-compatible — all producers and consumers use the standard Kafka client.
- No ZooKeeper/KRaft coordination overhead; Redpanda is a single binary with its own Raft.
- Smaller k8s footprint (1 pod vs Kafka's 3 broker + ZooKeeper minimum).
- Better suited for a kind cluster with constrained resources.
- The Redpanda Helm chart is well-maintained.

## Consequences

- **Positive:** Kafka-compatible so clients are portable; small footprint for dev;
  replay capability for debugging and compliance re-processing.
- **Negative:** Another stateful service to operate. Redpanda is younger than Kafka;
  some advanced Kafka features may be missing (not needed for ATOM's use case).

---

