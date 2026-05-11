# Task 04d — Runtime Fix, MinIO Population, and Full Observability

> **Status**: Open. Prerequisites: tasks 01–04c complete.
>
> Three independent issues found during 04c review + one planned feature.
> All must be completed before task 05 (ATS end-to-end demo rehearsal).

---

## What was found (audit, 2026-05-08)

### Finding 1 — Agent deploy path bypasses LocalDeployManager (04c Part E incomplete)

`builder-backend/app/routes/agents.py` `deploy_agent()` still calls
`build_and_run()` directly at line 126. The `LocalDeployManager` class
added in 04c exists in `container.py` but is never used by the deploy
route. Similarly, `stop_and_remove()` is called directly instead of
`deploy_mgr.undeploy()`.

**Impact**: The audit trail says "deployed via LocalDeployManager" but
the code does not reflect this. When Phase 2 swaps LocalDeployManager
internals for Kubernetes/Kruise, the swap must happen in one place.

**Fix**: Route all container lifecycle calls through `LocalDeployManager`
in `agents.py`. Existing running agent containers don't need to be
restarted — they are functionally identical. Future deploys will use
the correct path.

### Finding 2 — MinIO buckets are empty (4 of 5)

`minio-init` creates all 5 buckets at startup, but only `audit-logs`
receives data. The other four receive nothing:

| Bucket | Should contain | Currently |
|---|---|---|
| `audit-logs` | LiteLLM LLM call logs, workflow node events | ✅ populated |
| `agent-artifacts` | compiled agent.py, spec YAML, build metadata per deploy | ❌ empty |
| `specs` | workflow spec YAMLs on save/register; agent specs on deploy | ❌ empty |
| `workflow-artifacts` | final ctx JSON, run summary per completed run | ❌ empty |
| `uploaded-documents` | files uploaded via Chat/Builder Test panel | ❌ empty |

**Fix**: Add writes to builder-backend (agent-artifacts, specs) and
workflow-backend (workflow-artifacts, specs). Document the write pattern
for uploaded-documents (deferred to the file-upload feature).

### Finding 3 — OTEL collector has no persistent backend

`otel/config.yaml` exports traces to Studio (`/api/otel`) and `debug`
console. There is no:
- Log aggregation (no Loki)
- Trace storage (no Tempo)
- Metric storage (no Prometheus/Mimir)
- Unified dashboard (no Grafana)
- Structured log collection from Docker containers (no Alloy/Promtail)

The result: traces and logs are lost on container restart; no long-term
visibility into LLM usage, workflow throughput, error rates, or latency.

---

## Goals

1. **LocalDeployManager wired** — `deploy_agent` and `delete_agent` routes
   use `LocalDeployManager`. One place to swap for Phase 2.
2. **MinIO populated** — all four empty buckets receive writes from the
   appropriate service at the appropriate lifecycle events.
3. **Full observability stack** — Grafana + Loki + Tempo + Alloy. Every
   container log, every OTEL trace, and key metrics are captured,
   queryable, and dashboarded.

---

## Part A — LocalDeployManager wired

### A.1 `agents.py` — deploy path

Replace the direct `build_and_run()` call:

```python
from app.core.container import LocalDeployManager, WORK_DIR, AGENT_PORT

deploy_mgr = LocalDeployManager(
    workdir=str(WORK_DIR / "agents" / f"{name}-{spec.metadata.version}")
)
result = deploy_mgr.deploy(
    name=name,
    version=spec.metadata.version,
    agent_code=code,
    port=AGENT_PORT,
    env=env,
)
endpoint = result["endpoint"]
```

### A.2 `agents.py` — undeploy path

Replace the direct `stop_and_remove()` call:

```python
deploy_mgr = LocalDeployManager(
    workdir=str(WORK_DIR / "agents" / f"{name}-{existing['version']}")
)
deploy_mgr.undeploy(name=name, version=existing["version"])
```

### A.3 Note on existing running containers

The 4 currently-running agent containers
(`agent-kyc-refresh-1-0-0`, `agent-asset-recon-1-0-0`, etc.) are
functionally identical to what LocalDeployManager would produce — the
wrapper uses the same Docker operations. No restart required.
Document this in the session log.

---

## Part B — MinIO bucket population

### B.1 `agent-artifacts` bucket — builder-backend writes

On successful `deploy_agent`:

```
agent-artifacts/
  <name>/
    <version>/
      agent.py          ← compiled agent code
      spec.yaml         ← the agent spec YAML as deployed
      metadata.json     ← {name, version, owner, service_account_id,
                           deployed_at, code_hash, spec_hash, endpoint}
```

On `delete_agent`: write a tombstone `metadata.json` with `status: undeployed`.

### B.2 `specs` bucket — both backends write

When workflow spec is saved (`PUT /workflows/{name}/spec`):
```
specs/workflows/<name>/<version>/<timestamp>.yaml
```

When agent spec is deployed:
```
specs/agents/<name>/<version>/spec.yaml
```

### B.3 `workflow-artifacts` bucket — workflow-backend writes

When a workflow run completes (successfully or with error):
```
workflow-artifacts/
  <workflow_name>/
    <run_id>/
      result.json     ← {run_id, workflow_name, status, final_context,
                          node_count, duration_ms, completed_at}
      events.json     ← list of all SSE events emitted during the run
```

### B.4 `uploaded-documents` bucket — deferred

The file-upload path (Chat attachment, OCR input) will write here in
a future task. The bucket exists and is ready. Add a note in the doc.

---

## Part C — Observability stack (Alloy + Loki + Tempo + Grafana)

### C.1 Stack overview

```
Docker containers
    │ stdout/stderr (JSON structured where possible)
    ▼
Grafana Alloy          ← modern collector; replaces Promtail + Grafana Agent
    ├── logs ──────────► Loki (port 3100)  ← queryable log store
    └── traces ─────────► Tempo (port 3200) ← OTLP trace store

OTEL collector (existing)
    ├── receives from: builder-backend, workflow-backend, LiteLLM
    └── exports to: Tempo (OTLP gRPC) + debug console

Grafana (port 3001)    ← unified dashboard; queries Loki + Tempo
    ├── datasource: Loki
    ├── datasource: Tempo
    └── dashboards: Platform Overview, Agent Invocations,
                   Workflow Executions, LLM Usage, Human Tasks
```

Port allocations (new services):
- Grafana: `3001` (Studio owns `3000`)
- Loki:    `3100`
- Tempo:   `3200` (HTTP/gRPC query) + receives OTLP internally via `14317`
- Alloy:   no host ports needed (outbound only)

### C.2 New config files

```
alloy/
  config.alloy          ← Alloy River config (log scraping + OTLP relay)
loki/
  config.yaml           ← Loki single-binary config
tempo/
  config.yaml           ← Tempo config
grafana/
  provisioning/
    datasources/
      datasources.yaml  ← Loki + Tempo auto-provisioned
    dashboards/
      dashboards.yaml   ← dashboard folder config
      platform-overview.json    ← pre-built dashboard JSON
```

### C.3 Updated `otel/config.yaml`

Add Tempo as an exporter:
```yaml
exporters:
  otlp/tempo:
    endpoint: tempo:4317
    tls:
      insecure: true
  otlphttp/studio:
    endpoint: http://studio:3000/api/otel
    tls:
      insecure: true
  debug:
    verbosity: normal

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/tempo, otlphttp/studio]
    metrics:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
```

### C.4 Structured logging in platform services

Add JSON-format structlog/logging to builder-backend and workflow-backend
so Alloy + Loki can parse fields (agent_name, run_id, duration_ms, etc.)
rather than raw text lines.

Key fields to include in every log line:
- `service`: builder-backend | workflow-backend
- `level`: info | warning | error
- `event`: the operation name
- `run_id` / `agent_name` where applicable

### C.5 Grafana dashboards (provisioned on startup)

**Platform Overview** dashboard:
- Total agent deploys (last 24h)
- Active workflow runs
- LLM calls per hour (from Loki / audit-logs)
- Human tasks open vs resolved
- Error rate by service

**Agent Invocations** dashboard:
- Invocations by agent name
- Confidence score distribution (histogram from logs)
- P50/P95 latency (from traces in Tempo)
- Error rate

**Workflow Executions** dashboard:
- Runs started/completed/failed per hour
- Node-type breakdown (agent/http/decision/human_task)
- SLA compliance for human_task nodes

---

## Definition of Done

- [ ] `deploy_agent` route uses `LocalDeployManager.deploy()` — not `build_and_run()` directly
- [ ] `delete_agent` route uses `LocalDeployManager.undeploy()` — not `stop_and_remove()` directly
- [ ] New deploy creates objects in `agent-artifacts/<name>/<version>/`
- [ ] New deploy writes spec to `specs/agents/<name>/<version>/spec.yaml`
- [ ] Workflow spec save/register writes to `specs/workflows/<name>/`
- [ ] Completed workflow run writes result + events to `workflow-artifacts/<name>/<run_id>/`
- [ ] Loki, Tempo, Grafana, Alloy all healthy (`docker compose ps`)
- [ ] Alloy scrapes Docker container logs; visible in Grafana → Explore → Loki
- [ ] OTEL traces from workflow runs visible in Grafana → Explore → Tempo
- [ ] Grafana provisioned with Loki + Tempo datasources (no manual setup needed)
- [ ] Platform Overview dashboard renders with live data
- [ ] `otel/config.yaml` exports traces to Tempo
- [ ] Session log updated

## What this task does NOT do

- Does not add auth to Grafana (demo stack, anonymous access is fine)
- Does not set up Prometheus/Mimir for long-term metric storage (Alloy's
  log-based metrics are enough for the demo)
- Does not add Grafana alerting
- Does not implement `uploaded-documents` write path (deferred to file-upload feature)
- Does not upgrade existing running agent containers
  (they work correctly; LocalDeployManager fix applies to future deploys)
