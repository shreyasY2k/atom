# ATOM Kafka Topic Schemas

Four topics are created on Redpanda at startup. All messages are JSON-encoded
UTF-8. Each topic uses the default Redpanda partition count (1 in dev).

---

## `atom.audit`

Produced by: **GATE** (every HTTP request, after policy evaluation)
Consumer groups: `log-archiver`, Grafana Alloy (future)
Message key: `agent_id` (for partition consistency; empty string for unauthenticated requests)

```json
{
  "timestamp": "2024-01-15T10:23:45.123Z",
  "domain_id": "uuid",
  "agent_id": "uuid",
  "token_type": "agent|human",
  "caller_token_hash": "sha256-hex",
  "method": "POST",
  "path": "/v1/chat/completions",
  "policy_decision": {
    "allow": true,
    "reason": "policy:allow"
  },
  "status_code": 200,
  "latency_ms": 142
}
```

Note: Every `atom.audit` message is also written to the `audit_log_chain` Postgres
table with a SHA-256 / HMAC integrity chain. The Kafka topic is the streaming
copy; Postgres is the authoritative tamper-evident store.

---

## `atom.llm`

Produced by: **atom-llm** (KafkaAuditLogger callback, on every LiteLLM call)
Consumer groups: `log-archiver`
Message key: `agent_id` (from LiteLLM metadata)

```json
{
  "timestamp": "2024-01-15T10:23:45.456Z",
  "agent_id": "uuid",
  "model": "gpt-4o",
  "prompt_tokens": 150,
  "completion_tokens": 80,
  "latency_ms": 1240,
  "success": true
}
```

---

## `atom.agent.logs`

Produced by: **Grafana Alloy DaemonSet** (tailing `/var/log/containers/` for
`atom-agents` namespace) in K8s.
In dev/testing: can also be produced via the `POST /api/domains/{domain_id}/agents/{agent_id}/test-log` endpoint.
Consumer groups: `log-archiver`, `studio-log-viewer` (atom-studio WebSocket broadcaster)
Message key: `agent_id`

Simple format (dev / test-log endpoint):
```json
{
  "timestamp": "2024-01-15T10:23:45.789Z",
  "agent_id": "uuid",
  "message": "log line text",
  "source": "stdout|stderr"
}
```

OTLP JSON format (from Alloy `otelcol.exporter.kafka` with `encoding = "otlp_json"`):
```json
{
  "resourceLogs": [{
    "resource": {
      "attributes": [
        {"key": "agent_id", "value": {"stringValue": "uuid"}},
        {"key": "k8s.pod.name", "value": {"stringValue": "agent-uuid-xyz"}},
        {"key": "k8s.namespace.name", "value": {"stringValue": "atom-agents"}}
      ]
    },
    "scopeLogs": [{
      "logRecords": [{
        "body": {"stringValue": "log line text"},
        "timeUnixNano": "1705314225789000000"
      }]
    }]
  }]
}
```

The `LogBroadcaster` in atom-studio handles both formats.

---

## `atom.deployments`

Produced by: **atom-studio-api** (deployment lifecycle, HITL decisions)
Consumer groups: `log-archiver`
Message key: `deployment_id` (or `hitl_id` for HITL events)

### deployment_submitted
```json
{
  "timestamp": "2024-01-15T10:23:45.000Z",
  "source": "atom-studio-api",
  "event": "deployment_submitted",
  "deployment_id": "uuid",
  "agent_id": "uuid",
  "version": 3,
  "image": "ghcr.io/org/agent:sha-abc123",
  "git_sha": "abc123def456",
  "submitted_by": "user-uuid"
}
```

### deployment_approved
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "source": "atom-studio-api",
  "event": "deployment_approved",
  "deployment_id": "uuid",
  "agent_id": "uuid",
  "image": "ghcr.io/org/agent:sha-abc123"
}
```

### hitl_created
```json
{
  "timestamp": "2024-01-15T10:23:45.000Z",
  "source": "atom-studio-api",
  "event": "hitl_created",
  "hitl_id": "uuid",
  "agent_id": "uuid",
  "workflow_type": "DEPLOYMENT_APPROVAL",
  "expires_at": "2024-01-16T10:23:45.000Z"
}
```

### hitl_decided
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "source": "atom-studio-api",
  "event": "hitl_decided",
  "hitl_id": "uuid",
  "approved": true,
  "decided_by": "user-uuid",
  "note": "LGTM"
}
```

---

## MinIO Archive Layout

The `log-archiver` service archives all topics to MinIO under the `atom-audit` bucket:

```
atom-audit/
  atom.audit/
    2024/01/15/10/batch-<uuid>.jsonl
    2024/01/15/10/batch-<uuid>.jsonl
  atom.llm/
    2024/01/15/10/batch-<uuid>.jsonl
  atom.agent.logs/
    2024/01/15/10/batch-<uuid>.jsonl
  atom.deployments/
    2024/01/15/10/batch-<uuid>.jsonl
```

Each `.jsonl` file contains up to 100 JSON objects (one per line), flushed every
30 seconds if fewer than 100 messages have arrived. Files can be queried directly
with DuckDB:

```sql
SELECT event->>'agent_id', event->>'path', event->>'status_code'
FROM read_json('s3://atom-audit/atom.audit/2024/01/15/**/*.jsonl')
LIMIT 100;
```
