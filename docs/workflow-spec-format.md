# Workflow Spec Format

`workflow-spec.yaml` is the source of truth for what a workflow does.
The Composer canvas is UX over this file. Every spec lives in
`specs/workflows/` and is version-controlled.

---

## Top-level structure

```yaml
apiVersion: atom.platform/v1
kind: WorkflowDeployment

metadata:
  name: my-workflow            # kebab-case, unique across registered workflows
  domain: banking-securities-ops
  version: 1.0.0               # semver
  description: One sentence.
  owner: team-name-or-email

spec:
  input_schema: ...            # JSON Schema for the run's input payload
  error_handler: notify        # node to jump to on any unhandled error (optional)
  timeout_seconds: 86400       # hard cap on the whole run in seconds (optional)
  nodes: [...]
  audit:
    log_to: minio://audit-logs/workflow/<name>
    retention_days: 90         # must be >= 90 (compliance requirement)
  deployment:
    runtime: temporal
    task_queue: <name>-task-queue
```

---

## Common fields — every node type

```yaml
- id: my-node              # kebab-case, unique within the workflow
  label: "Human label"     # shown in Composer canvas and task UI
  type: agent | http | decision | human_task
  description: "..."       # longer documentation string (stored in audit log)

  # Control flow
  next: next-node-id       # next node (null = terminal)

  # Error handling
  on_error: error-handler-node-id
  # If this node raises an exception, jump to on_error instead of failing.
  # Falls back to spec.error_handler if not set here.
  # ctx._last_error = {node_id, error} is written before the jump.

  # Execution constraints
  timeout_seconds: 300     # max wall-clock seconds (default 300 for all types)
  retry:                   # applies to agent and http nodes
    max_attempts: 3
    backoff: exponential | linear | constant   # default: exponential
    initial_delay_seconds: 1.0
    max_delay_seconds: 60.0

  # Metadata
  tags: [compliance, human-in-the-loop]
```

---

## Node type: `agent`

Invokes a deployed agent from the Agent Builder registry via its `/invoke` endpoint.

```yaml
- id: kyc-refresh
  label: "KYC refresh"
  type: agent

  agent_ref:
    name: kyc-refresh          # name in the agent registry
    version: latest            # or a specific semver, e.g. "1.2.0"

  input_mapping:
    # Left  = field name the agent expects
    # Right = ctx expression  (bare: ctx.input.X  or  template: "{{ ctx.X.Y }}")
    customer_id: ctx.input.customer_id
    transfer_id: "{{ ctx.input.transfer_id }}"

  output_capture: kyc_result   # agent output stored at ctx.kyc_result

  # Confidence-threshold routing
  # If agent.confidence < threshold, jump to fallback_node instead of next.
  confidence_threshold: 0.85
  fallback_node: kyc-human-review   # required when confidence_threshold is set

  timeout_seconds: 120
  retry:
    max_attempts: 2
    backoff: constant
    initial_delay_seconds: 5.0
  on_error: kyc-human-review
  next: ofac-screen
```

**Notes:**
- The agent receives `{"input": <resolved input_mapping>}` as the POST body.
- If the agent does not return a `confidence` field it defaults to `1.0`
  (threshold routing never fires).
- On error the runner stores `{"error": ..., "confidence": 0.0, "_failed": true}`
  and routes via `on_error` if set, otherwise the workflow fails.

---

## Node type: `http`

Makes an HTTP call to any service reachable on the agentnet Docker network.

```yaml
- id: ofac-screen
  label: "OFAC sanctions screening"
  type: http

  method: GET | POST | PUT | DELETE | PATCH
  url_template: "http://ofac-svc:8096/screen"
  # {{ ctx.* }} interpolation is supported in url_template

  headers:
    X-Request-ID: "{{ ctx.input.transfer_id }}"

  body_template:                 # POST/PUT/PATCH only; ctx-interpolated
    customer_id: "{{ ctx.input.customer_id }}"
    destination: "{{ ctx.input.destination }}"

  # Authentication — injected as headers before the call
  # auth.token / key / password may use ctx expressions
  auth:
    type: bearer                 # bearer | basic | api_key
    token: "{{ ctx.env.SWIFT_API_TOKEN }}"

  # auth:
  #   type: basic
  #   username: svc-account
  #   password: "{{ ctx.env.SVC_PASSWORD }}"

  # auth:
  #   type: api_key
  #   header: X-API-Key          # header name, defaults to X-API-Key
  #   key: "{{ ctx.env.OFAC_KEY }}"

  # Response field extraction — dot-path into the JSON body
  extract:
    sanctions_hit: result.hit          # stored as ctx.ofac_result.sanctions_hit
    risk_score:   result.risk_score
    screening_id: result.screening_id
  # Unextracted fields are still present in output_capture alongside extracted ones.

  # Acceptable HTTP status codes (default: any 2xx).
  # Non-matching status adds _soft_fail=true to the result.
  expect_status: [200, 201, 202]

  output_capture: ofac_result
  timeout_seconds: 10
  retry:
    max_attempts: 2
    backoff: constant
    initial_delay_seconds: 2.0
  on_error: notify
  next: amount-decision
```

### Async polling

For APIs that return a job ID and require polling:

```yaml
- id: batch-validate
  type: http
  method: POST
  url_template: "http://validator:8099/jobs"
  body_template:
    transfer_id: "{{ ctx.input.transfer_id }}"
  output_capture: validation_result

  poll:
    poll_url_template: "http://validator:8099/jobs/{{ ctx.validation_result.job_id }}"
    interval_seconds: 5         # seconds between polls
    max_attempts: 12            # stop after this many polls regardless
    done_condition: ctx.poll_result.status == "completed"
    # done_condition is a safe Python expression; ctx.poll_result is the GET response

  next: next-node
```

The final `output_capture` value is the last poll response with `extract`
fields merged in (if `extract` is also set).

---

## Node type: `decision`

Evaluates conditions and routes to different nodes. Two modes:

### Binary (true / false)

```yaml
- id: high-value-check
  label: "High-value transfer?"
  type: decision

  expression: ctx.input.amount_usd > 250000
  # Safe Python: arithmetic, comparisons, boolean ops, ctx.* access only.
  # No function calls, no imports.

  branches:
    true:  compliance-review
    false: asset-recon
```

### Multi-way (cases list)

```yaml
- id: amount-tier
  label: "Route by amount tier"
  type: decision

  cases:
    - condition: ctx.input.amount_usd > 1000000
      target: senior-compliance-review
      label: "Ultra high-value (>$1M)"
    - condition: ctx.input.amount_usd > 250000
      target: compliance-review
      label: "High-value ($250K-$1M)"
    - condition: ctx.ofac_result.sanctions_hit == true
      target: compliance-review
      label: "Sanctions flag"
  default: asset-recon
  # default is REQUIRED with cases. Used when no case matches.
  # Cases evaluated in order; first match wins.
```

**Expression language rules:**
- Allowed: `==`, `!=`, `<`, `>`, `<=`, `>=`, `and`, `or`, `not`, `in`,
  `is`, arithmetic, string literals, numeric literals, ctx.* access.
- Forbidden: function calls, imports, attribute access on anything other than `ctx`.

---

## Node type: `human_task`

Pauses the workflow, creates a task in the task queue, and waits for a
human decision before continuing.

```yaml
- id: compliance-review
  label: "Compliance review"
  type: human_task

  # Assignment — one of these is required
  assignee_group: compliance   # ops | compliance | risk-management | audit | risk | legal
  # assignee_individual: alice@bank.com   # specific user; takes precedence over group

  task_template:
    title: "Compliance review: {{ ctx.input.transfer_id }}"
    description: >
      Transfer of ${{ ctx.input.amount_usd }} requires review.
      KYC: {{ ctx.kyc_result.recommendation }}.
    actions: [accept, reject, edit]   # buttons shown to the reviewer

  priority: low | medium | high | critical   # default: medium; affects queue ordering
  sla_seconds: 14400                          # 4 hours

  # Evidence — which ctx keys to surface to the reviewer.
  # If omitted, the full ctx is shown.
  evidence: [kyc_result, ofac_result, recon_result]

  # Form schema — JSON Schema for the Edit form.
  # If omitted, Edit shows a raw JSON editor.
  form_schema:
    type: object
    properties:
      override_reason: { type: string }
      adjusted_amount: { type: number }

  # Auto-skip — if condition is true, skip creating a task entirely.
  # Resolves immediately with auto_resolution and continues to next.
  skip_if:
    condition: ctx.input.amount_usd < 1000
    auto_resolution: accept   # accept | reject

  # SLA expiry policy — what happens when sla_seconds elapses with no resolution.
  escalation_policy:
    action: escalate        # escalate | auto_approve | auto_reject
    escalate_to_group: risk-management
    # escalate   → new task created for escalate_to_group at priority=critical
    # auto_approve → resolves with "accept" immediately
    # auto_reject  → resolves with "reject" immediately

  output_capture: compliance_decision
  next: swift-submit
```

**Resolution object written to `output_capture`:**

```json
{
  "task_id":     "TASK-XXXX",
  "resolution":  "accept | reject | edit | timeout",
  "resolved_by": "human:alice@bank.com | system:sla-auto-approve | system:sla-expired",
  "edits":       {},
  "skipped":     true,
  "escalated":   true,
  "sla_expired": true
}
```

---

## Context (`ctx`) — how data flows

Every node reads from `ctx` and writes to it via `output_capture`.

| Key | Set by |
|---|---|
| `ctx.input` | The workflow's input payload (from `/runs` POST body) |
| `ctx.<output_capture>` | Each node that declares `output_capture` |
| `ctx._last_error` | Set when `on_error` routing fires: `{node_id, error}` |

**Template syntax in `url_template`, `body_template`, `task_template`:**

```
{{ ctx.input.transfer_id }}   Jinja-style; works in any string value
ctx.input.transfer_id         Bare expression; works in input_mapping values
```

---

## Error handling flow

```
Node executes
    |
    +-- success --> output_capture written --> next
    |
    +-- exception / timeout
            |
            +-- node.on_error set?
            |       yes --> jump to on_error  (ctx._last_error written)
            |
            +-- spec.error_handler set?
            |       yes --> jump to error_handler  (ctx._last_error written)
            |
            +-- neither --> workflow_failed event; run terminates
```

---

## Validation rules

| Rule | Detail |
|---|---|
| Unique IDs | Every `node.id` unique within the workflow |
| Valid targets | All `next`, branch targets, `on_error`, `fallback_node`, `cases[*].target`, `default` must be valid node IDs |
| Terminal exists | At least one node with `next: null` and no branches/cases |
| error_handler | If set, must reference a valid node ID |
| **agent** | `confidence_threshold` requires `fallback_node` |
| **agent** | Soft check: agent must exist in registry and be deployed |
| **http** | `url_template` and `method` are required |
| **http** | `auth.type=bearer` requires `token` |
| **http** | `auth.type=basic` requires `username` + `password` |
| **http** | `auth.type=api_key` requires `key` |
| **http** | `poll.done_condition` required when `poll` is set; must pass safe-AST check |
| **decision** | Must have `expression + branches` OR `cases + default` (not neither) |
| **decision** | `cases` requires `default` |
| **decision** | All `expression` and `cases[*].condition` pass safe-AST check |
| **human_task** | `assignee_group` or `assignee_individual` required |
| **human_task** | `assignee_group` must be in `{ops, compliance, risk-management, audit, risk, legal}` |
| **human_task** | Each action in `{accept, reject, edit}` |
| **human_task** | `escalation_policy.action=escalate` requires `escalate_to_group` |
| **human_task** | `skip_if.condition` passes safe-AST check |
| **Safety gate** | Any non-GET http call to a state-changing service (`swift-gw`) must have a `human_task` immediately before or after it |
| **audit** | `retention_days >= 90` |

---

## Build & deploy verbs

| Verb | Endpoint | What it does |
|---|---|---|
| validate | `POST /specs/workflow/validate` | Schema + graph check. Returns `{valid, errors[]}`. |
| save | `PUT /workflows/{name}/spec` | Writes YAML to disk. Does not validate or register. |
| register | `POST /workflows/{name}/register` | Validates, then registers with Temporal. Accepts optional `yaml_text`. |
| run | `POST /workflows/{name}/runs` | Starts execution with input payload; returns `run_id`. |
| events | `GET /workflows/{name}/runs/{run_id}/events` | SSE stream of node events. |
| history | `GET /workflows/{name}/runs` | Recent runs list. |
| cancel | `POST /runs/{run_id}/cancel` | Cancels a running execution. |
| resolve | `POST /tasks/{task_id}/resolve` | Body: `{resolution, resolved_by, edits?}`. |

---

## SSE event types

| Event | Key fields |
|---|---|
| `workflow_started` | `run_id` |
| `node_started` | `run_id`, `node_id`, `actor_type`, `actor_id` |
| `node_completed` | `run_id`, `node_id`, `output_summary`, `duration_ms` |
| `node_paused` | `run_id`, `node_id`, `task_id` |
| `node_routed` | `run_id`, `from`, `to`, `reason` |
| `node_skipped` | `run_id`, `node_id`, `reason` |
| `node_error` | `run_id`, `node_id`, `error`, `routed_to` |
| `workflow_completed` | `run_id`, `final_ctx_keys` |
| `workflow_failed` | `run_id`, `reason` |

---

## Full example

See `specs/workflows/ats-asset-transfer.yaml` — a 10-node ATS workflow
that demonstrates every attribute described in this document:

- `http` with `auth`, `extract`, `expect_status`, `retry`, `on_error`
- `agent` with `confidence_threshold`, `fallback_node`, `retry`, `on_error`
- `decision` with multi-way `cases` + `default`
- `human_task` with `priority`, `evidence`, `skip_if`, `escalation_policy`, `form_schema`
- Workflow-level `error_handler` pointing to the notify node

---

## Phase 2 roadmap

| Feature | Why deferred |
|---|---|
| Parallel forks | Temporal supports it; requires a join/merge node in canvas |
| Loop / forEach | Temporal supports it; needs loop node + break condition |
| Sub-workflow | Temporal child workflows; increases designer complexity |
| `transform` node | Pure data reshaping without external call |
| `timer` / `sleep` | Temporal timers available; demo does not need scheduled waits |
| `open` reasoning_mode agents | High variance at temperature=1.0 |
