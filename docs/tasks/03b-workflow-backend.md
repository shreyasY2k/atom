# Task 03b — Workflow Backend + Temporal Worker

## Goal

`workflow-backend` (FastAPI on port 8082) accepts workflow specs, validates them, registers them with Temporal, exposes execution endpoints, and runs the worker that interprets `workflow-spec.yaml` as a Temporal workflow at runtime.

## Endpoints to implement

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/specs/workflow/validate` | Validate `workflow-spec.yaml` |
| `POST` | `/specs/workflow/generate` | NL prose → workflow-spec (Mode C, optional) |
| `POST` | `/workflows/{name}/register` | Register the spec with Temporal worker |
| `GET` | `/workflows` | List registered workflows |
| `GET` | `/workflows/{name}` | Get workflow record |
| `POST` | `/workflows/{name}/runs` | Start a new run with input payload |
| `GET` | `/workflows/{name}/runs/{run_id}` | Get run status + node-by-node history |
| `GET` | `/workflows/{name}/runs/{run_id}/events` | SSE stream of execution events for live UI |
| `POST` | `/runs/{run_id}/cancel` | Cancel a running execution |

The Temporal worker (`temporal/worker.py`) is already stubbed. This task wires it into a real service.

## Validation rules to enforce

From `docs/workflow-spec-format.md`:

1. Schema valid (Pydantic)
2. All node IDs unique within workflow
3. All `next` and branch targets resolve to valid node IDs
4. Exactly one terminal node (`next: null`)
5. For `agent` nodes: `agent_ref.name` exists in agent registry (call builder-backend `/agents/{name}`)
6. For `agent` nodes with `confidence_threshold`: `fallback_node` is set and exists
7. For `decision` nodes: expression parses with Python `ast` and uses only safe constructs (no calls, no imports, no attribute access beyond `ctx.*`)
8. For `human_task` nodes: `assignee_group` is in `["ops", "compliance", "risk-management", "audit"]`; all `actions` in `[accept, reject, edit]`
9. **BFSI invariant**: every state-changing `http` call (`method != GET`, hits a registered "state-changing" service) must have a `human_task` predecessor or successor in the path. Maintain a list of "state-changing services" — initially: `swift-gw`. The validator walks all paths; if any state-changing call has no human gate adjacent, validation fails.

If validation fails, return `400` with a list of specific node IDs and the reason for each failure. Don't return one error at a time; collect them all.

## File layout

```
workflow-backend/
├── Dockerfile
├── requirements.txt
└── app/
    ├── __init__.py
    ├── main.py                  # FastAPI app + routes
    ├── routes/
    │   ├── specs.py             # validate + generate
    │   ├── workflows.py         # register + list + get
    │   └── runs.py              # start + get + cancel + events
    ├── core/
    │   ├── schema.py            # Pydantic models for workflow-spec
    │   ├── validator.py         # the rule set above
    │   ├── temporal_client.py   # async wrapper around temporalio.client.Client
    │   ├── audit.py             # MinIO event emit per node
    │   └── codegen.py           # NL → workflow-spec (Mode C, optional)
    └── worker/
        ├── __init__.py
        ├── runner.py            # AtomWorkflowRunner (the one in temporal/worker.py — moved here and finished)
        ├── activities.py        # invoke_agent / http_call / decision / human_task
        └── audit_helpers.py     # structured event emission from inside activities
```

The Temporal worker runs as a goroutine inside `workflow-backend` for V1. (In Phase 2: separate process, scaled independently.)

## Run lifecycle

When `POST /workflows/ats-asset-transfer/runs` is called with payload:

1. Validate input against `workflow-spec.input_schema`
2. Generate `run_id = f"run-{uuid4()}"`
3. Look up agent endpoints for every `agent` node by querying builder-backend `/agents/{name}` — pass the resulting `agent_endpoints` dict to the worker
4. Start a Temporal workflow execution: `AtomWorkflowRunner` with args `{spec, input, agent_endpoints, task_queue_url}`
5. Emit run-start audit event
6. Return `run_id` immediately (don't block on completion)

The execution is asynchronous; the UI subscribes to `/runs/{run_id}/events` (SSE) for live updates. Each node's start/end is an event.

## SSE event format

```json
{"event": "node_started", "run_id": "...", "node_id": "kyc-refresh",
 "node_type": "agent", "actor_type": "agent", "actor_id": "svc-acct-kyc-refresh-001",
 "ts": "2026-05-08T..."}
{"event": "node_completed", "run_id": "...", "node_id": "kyc-refresh",
 "output_summary": {"confidence": 0.94, "recommendation": "PASS"},
 "duration_ms": 3420, "ts": "..."}
{"event": "node_routed", "run_id": "...", "from": "kyc-refresh", "to": "ofac-screen",
 "reason": "confidence 0.94 >= threshold 0.85", "ts": "..."}
```

The frontend's Composer canvas highlights nodes as `node_started`/`node_completed` events arrive. This is what makes the live demo visible.

## Audit event emission

Every node execution emits two events to `minio://audit-logs/workflow-run/{date}/{run_id}/`:

```json
// On node start
{"run_id": "...", "node_id": "kyc-refresh", "type": "node_start",
 "actor_type": "agent", "actor_id": "svc-acct-kyc-refresh-001",
 "ts": "..."}

// On node completion
{"run_id": "...", "node_id": "kyc-refresh", "type": "node_complete",
 "actor_type": "agent", "actor_id": "svc-acct-kyc-refresh-001",
 "output_hash": "sha256:...", "duration_ms": 3420, "result": "ok",
 "ts": "..."}
```

For `http` nodes the actor is `system:workflow-engine`. For `human_task` resolution, the actor is the human user from the task's `resolved_by` field.

## Definition of Done

- [ ] `POST /specs/workflow/validate` accepts the ATS workflow spec without errors
- [ ] `POST /specs/workflow/validate` rejects an invalid spec (e.g. missing fallback_node when threshold is set) with a clear error list
- [ ] `POST /workflows/ats-asset-transfer/register` registers the workflow
- [ ] `POST /workflows/ats-asset-transfer/runs` with a routine $40K input starts a run that completes end-to-end
- [ ] During the run, KYC and asset-recon agent nodes invoke real deployed agents
- [ ] OFAC and SWIFT http nodes hit the mocks
- [ ] The decision node correctly branches by amount
- [ ] The final-accept human task pauses the workflow until resolved via task queue
- [ ] Each node generates audit events in MinIO with correct actor types
- [ ] `/runs/{run_id}/events` SSE stream emits node_started, node_completed, node_routed events
- [ ] BFSI validator rejects a spec that has SWIFT call without an adjacent human_task

## Common pitfalls

- **Confidence threshold routing skipped**: ensure the runner reads `confidence` from agent output and compares against threshold before falling through to `next`.
- **Decision node expression unsafe**: enforce AST validation; reject `__import__`, function calls, attribute access beyond `ctx.*`.
- **Human task timeout**: Temporal's `start_to_close_timeout` for `human_task_activity` should match `sla_seconds`; for demo, default to 1 hour.
- **Run hangs at human task**: ensure the SSE stream still emits a `node_paused` event so the UI knows to show the "task waiting" state.
- **Worker silently dies**: log to stdout; supervise via Docker restart policy.
