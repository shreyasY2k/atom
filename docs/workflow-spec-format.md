# Workflow Spec Format

`workflow-spec.yaml` is the source of truth for what a workflow does. The Composer UI is UX over this file. Every spec is committed to `specs/workflows/` and version-controlled.

## Schema

```yaml
apiVersion: mphasis.platform/v1
kind: WorkflowDeployment
metadata:
  name: <kebab-case-unique-name>           # required
  domain: <banking-ats|insurance-claims|...>  # required
  version: <semver>                        # required, e.g. "1.0.0"
  description: <one-line>
  owner: <team or email>                   # required for audit

spec:
  # Input schema for the whole workflow run
  input_schema:
    type: object
    required: [...]
    properties:
      ...

  nodes:
    - id: <kebab-case-unique-within-workflow>     # required
      label: <human-readable>                     # shown in canvas
      type: <agent | http | decision | human_task>  # required, one of four
      next: <node-id | null>                      # for linear flow
      # OR for branching from this node:
      branches:
        <branch-name>: <next-node-id>

      # ---- Type-specific config ----

      # If type == agent:
      agent_ref:
        name: <agent-name-in-registry>
        version: <semver | "latest">
      input_mapping:
        <agent-input-field>: <expression accessing ctx>
        # e.g.   customer_id: ctx.input.customer_id
      output_capture: <ctx-key>                   # where to store output
      confidence_threshold: 0.85                  # optional; if agent returns
                                                  # confidence below this,
                                                  # route to fallback_node
      fallback_node: <node-id>                    # required if threshold set

      # If type == http:
      method: <GET|POST|PUT|DELETE>
      url_template: <string with ctx interpolation>
      headers: { ... }
      body_template: { ... }                      # for non-GET
      output_capture: <ctx-key>
      timeout_seconds: 30
      retry: { max_attempts: 3, backoff: exponential }

      # If type == decision:
      expression: <python-safe expression evaluated against ctx>
      # e.g.    "ctx.input.amount > 250000"
      branches:
        true: <next-node-id>
        false: <next-node-id>

      # If type == human_task:
      assignee_group: <ops|compliance|risk-management|...>
      task_template:
        title: <string>
        description: <string with ctx interpolation>
        actions: [accept, reject, edit]           # which buttons to show
      sla_seconds: <int>                          # for in-demo SLA badge
      output_capture: <ctx-key>

  audit:
    log_to: minio://audit-logs/workflow/<name>
    retention_days: 90

  deployment:
    runtime: temporal                             # only supported value for V1
    task_queue: <string>                          # Temporal task queue name
```

## Validation rules (enforced by workflow-backend)

1. `metadata.name` must be unique among registered workflows.
2. Every `nodes[].id` must be unique within the workflow.
3. Every `nodes[].next` (or branch target) must be a valid node ID.
4. Exactly one node must be reachable from the start (the first in the list, by convention) and at least one node must have `next: null` (the terminal node).
5. For `type: agent`:
   - `agent_ref.name` must exist in the agent registry
   - `agent_ref.version` must resolve to a deployed version
   - All required `input_mapping` keys must match the agent's expected inputs
   - If `confidence_threshold` is set, `fallback_node` must be set
6. For `type: decision`:
   - Expression must parse with Python's `ast` and use only safe operators (no function calls, no attribute access beyond `ctx.*`)
   - Both `branches.true` and `branches.false` must be valid node IDs
7. For `type: human_task`:
   - `assignee_group` must be a registered group
   - All listed `actions` must be in `[accept, reject, edit]` (no custom actions in V1)
8. **At least one `human_task` node** must be reachable in any execution path that ends in an `http` call to a state-changing external system, OR an `human_task` must immediately follow such a call. This is a BFSI invariant; the validator enforces it.
9. `audit.retention_days` must be ≥ 90.

## Reference example

See `specs/workflows/ats-asset-transfer.yaml`.

## What changes through the visual Composer

- Add / remove / rewire nodes
- Edit any node's config (model, threshold, expression, task template)
- Replace an `http` or `human_task` node with an `agent` node by picking from the agent registry — this is the central demo gesture
- Edit `metadata.description`

## Build & deploy verbs

| Verb | What it does | Side effects |
|---|---|---|
| `validate` | Schema check + node graph check + agent existence check | None |
| `register` | Validates, then registers the workflow with Temporal | Workflow definition stored; ready to execute |
| `run` | Starts a new execution with given input | Temporal run created; events streamed back |
| `cancel` | Cancels a running execution | Cancellation event in audit log |
| `complete-task` | Resolves a paused human task | Workflow resumes |
