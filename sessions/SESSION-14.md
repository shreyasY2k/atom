# SESSION-14 — Kafka Logging Pipeline

**Prerequisites:** SESSION-13 complete  
**Goal:** Build the full Kafka → MinIO log archival pipeline and real-time log viewer in atom-studio.  
**Estimated time:** 1 day

---

## Tasks

1. **Define Kafka topic schemas** (`docs/kafka-schemas.md`):
   - `atom.audit` — GATE audit chain events (JSON)
   - `atom.llm` — LiteLLM request/response audit (JSON)
   - `atom.agent.logs` — agent pod stdout/stderr (JSON with `agent_id`, `level`, `message`)
   - `atom.deployments` — deployment lifecycle events (JSON)

2. **GATE Kafka producer** (verify SESSION-03 implementation, extend)
   - Produce to `atom.audit` topic for every request.
   - Ensure key = `agent_id` for partition consistency.

3. **atom-llm Kafka producer** (verify SESSION-05 implementation)

4. **Agent log shipper** — k8s DaemonSet running Grafana Alloy configured to tail
   pod logs from `atom-agents` namespace and produce to `atom.agent.logs` Kafka topic.

5. **log-archiver service** (`infra/log-archiver/`)  
   Simple Go binary (or Python):
   - Consumes all four topics.
   - Batches messages (100 msgs or 30s, whichever first).
   - Writes Parquet or JSON lines to MinIO:
     `s3://atom-audit/{topic}/{year}/{month}/{day}/{hour}/batch-{uuid}.jsonl`
   - Maintains a consumer group offset so restarts don't reprocess.

6. **Studio: real-time log viewer** (`/agents/{id}/logs` page)
   - Backend: WebSocket endpoint that subscribes to `atom.agent.logs` Kafka topic
     filtered by `agent_id`.
   - Frontend: auto-scrolling log console component with log level colour coding.

7. **Studio: audit log page** (`/audit`)
   - Paginated view of `audit_log_chain` table entries.
   - Filter by: domain, agent, date range.
   - "Verify chain" button — triggers backend to recompute and validate the hash chain.

---

## Technologies

| Technology | Rationale |
|---|---|
| Kafka consumer group | Guaranteed delivery; offset management for restart recovery |
| Parquet / JSON lines | Queryable with DuckDB/Athena for compliance reporting |
| Grafana Alloy log shipper | Already in stack; configured to forward to Kafka |

---

## Acceptance Criteria

- [ ] After 10 GATE requests, `atom.audit` topic has 10 messages.
- [ ] log-archiver has written at least one file to MinIO `atom-audit/atom.audit/` path.
- [ ] Studio real-time log viewer shows agent pod stdout in < 2s.
- [ ] "Verify chain" on audit page returns "Chain valid" (or shows first broken entry).

---

## Claude Code Starter Prompt

```
You are implementing SESSION-14 of ATOM — Kafka logging pipeline.

Context: Redpanda running with four topics. GATE and atom-llm already produce to Kafka.
MinIO running with atom-audit bucket.

Tasks:
1. Write infra/log-archiver/ — Go service (or Python) that:
   - Subscribes to all four Kafka topics as consumer group "log-archiver"
   - Batches 100 messages or 30 seconds
   - Writes JSON lines to MinIO: atom-audit/{topic}/{yyyy}/{mm}/{dd}/{hh}/batch-{uuid}.jsonl
   - Uses aws-sdk-go-v2 (or boto3) configured for MinIO endpoint
2. Write infra/manifests/log-archiver-deployment.yaml
3. Add k8s DaemonSet for Grafana Alloy pod log collection:
   - Tail /var/log/containers/ for atom-agents namespace pods
   - Produce to atom.agent.logs Kafka topic with agent_id extracted from pod labels
4. atom-studio: WebSocket /ws/agents/{id}/logs — subscribe to atom.agent.logs, filter by agent_id
5. atom-studio frontend: auto-scrolling log console at /agents/{id}/logs
6. atom-studio: /audit page with paginated audit_log_chain table + "Verify Chain" button
   - Verify chain: walk all entries in seq order, recompute HMAC, report first invalid entry

Test: run 20 requests, verify MinIO has archived logs, verify studio shows live logs.
```

---

