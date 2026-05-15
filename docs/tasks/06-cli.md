# Task 06 — CLI & Mode B polish

> **Updated** for the platform's current shape:
> - Workflow commands now mirror the visual Composer (build via 04b)
> - Agent scaffolding emits the new fields from 04c (`reasoning_mode`,
>   `input_schema`, `agentscope_skills`)
> - HITL task commands added (`atom tasks list / resolve`)
> - `atom runs` commands for inspecting and replaying workflow runs

## Goal

`atom` CLI is installable, all agent and workflow workflows work
end-to-end via CLI, and Mode B (manual editor + CLI) is demoable as
the developer-experience story alongside the UI.

By the end of this session, an engineer can do everything the UI does
without opening the UI: scaffold an agent, edit YAML, validate, deploy,
test-invoke, scaffold a workflow, edit YAML, validate, register, run,
list open HITL tasks, resolve them, and replay past runs.

## Hard rules

1. **Do not embed the Composer's visual layout in CLI commands.** CLI
   is text-first. Workflows scaffolded by CLI get default `metadata.
   layout` (top-to-bottom, 200px spacing); the Composer renders them
   correctly without the engineer doing layout work.
2. **CLI must call the same backend endpoints as the UI.** Don't add
   shortcut paths or special CLI-only logic. CLI is a UI skin; the
   backend doesn't know which client is talking to it.
3. **CLI does not run a worker.** Workflow execution happens in
   `workflow-backend`'s Temporal worker (Phase 1) regardless of
   whether the run was triggered by UI or CLI.
4. **No interactive prompts for scripting paths.** Every command runs
   non-interactively if all required args/flags are passed. Optional
   `--interactive` flag for guided creation.

## Steps

1. **Install CLI in editable mode.**
   ```bash
   cd cli/
   pip install -e .
   atom --help
   ```

2. **Scaffold a new agent end-to-end.**
   ```bash
   atom agent scaffold demo-agent --domain banking-kyc
   # Verifies:
   #   agent-roles/banking-kyc/demo-agent.role.md created
   #   specs/agents/demo-agent.yaml created with reasoning_mode,
   #     input_schema, sample_prompts placeholders
   ```
   Refuses to overwrite if either file exists.

3. **Validate the agent spec.**
   ```bash
   atom agent validate specs/agents/demo-agent.yaml
   # POSTs the file to builder-backend /specs/agent/validate
   # Pretty-prints validation result; exit 1 on errors
   ```

4. **List agents.**
   ```bash
   atom agent list
   # Hits builder-backend /agents; shows: name, version, mode, owner,
   # service-account ID, deploy status
   ```

5. **Compile + deploy an agent.**
   ```bash
   atom agent deploy demo-agent
   # Calls /agents/<name>/compile, then /agents/<name>/deploy
   # Streams progress (compile, build container, register identity,
   # start container, health check)
   # Prints the issued service-account ID on success
   ```

5b. **Deployment request flow** (depends on task 05b)
    ```bash
    # As Builder
    atom login --as builder
    atom agent deploy demo-agent
    # Output: "Submitted deployment request dep-A1B2C3D4 for agent
    #  demo-agent v0.1.0; waiting for approval"
    #  Track with: atom deployments get dep-A1B2C3D4
    atom deployments list --requester me

    # As Approver
    atom login --as approver
    atom deployments list --status pending
    atom deployments approve dep-A1B2C3D4 --note "approved"
    # Output: "Approved dep-A1B2C3D4 — deploy_status: deploying"

    # Back as Builder, see it deployed
    atom login --as builder
    atom agent history demo-agent
    ```

    Other deployment commands:
    ```bash
    atom deployments get dep-A1B2C3D4       # full record detail
    atom deployments reject dep-A1B2C3D4 --reason "spec incomplete"
    atom deployments request-changes dep-A1B2C3D4 --comments "add threshold docs"
    atom workflow register ats-asset-transfer   # role-aware (builder→request, admin→direct)
    atom workflow history ats-asset-transfer
    ```

    Role behaviour:
    - **Builder** (`atom login --as builder`): `agent deploy` and `workflow register` submit requests; never deploy directly
    - **Approver** (`atom login --as approver`): `agent deploy` deploys directly (own work); can also approve others' requests
    - **Admin** (`atom login --as admin`): `agent deploy` uses bypass deploy; recorded as "bypassed" in audit

6. **Test-invoke a deployed agent.**
   ```bash
   # Structured input
   atom agent invoke kyc-refresh \
     --input '{"customer_id": "CUST-100442"}'

   # Free-text input (uses the 04c adapter)
   atom agent invoke kyc-refresh \
     --text "refresh KYC for customer CUST-100442"

   # Pretty-prints the agent's response with mode badge and timing
   ```

7. **Init a workflow.**
   ```bash
   atom workflow init demo-workflow
   # Creates specs/workflows/demo-workflow.yaml with stub nodes,
   # default metadata.layout (top-to-bottom), placeholder
   # input_schema and sample_inputs
   ```

8. **Validate a workflow spec.**
   ```bash
   atom workflow validate specs/workflows/demo-workflow.yaml
   # POSTs to workflow-backend /specs/workflow/validate
   # Pretty-prints errors; reports BFSI-invariant violations clearly
   ```

9. **Register a workflow with the engine.**
   ```bash
   atom workflow register demo-workflow
   # Validates, then calls /workflows/<name>/register
   # Workflow is now executable
   ```

10. **List workflows.**
    ```bash
    atom workflow list
    # name, version, registered_at, last run timestamp, last status
    ```

11. **Run a workflow.**
    ```bash
    # With explicit input
    atom workflow run ats-asset-transfer \
      --input '{"transfer_id": "...", "customer_id": "CUST-100442", ...}'

    # With a sample input from the spec
    atom workflow run ats-asset-transfer \
      --sample "Routine $40K"

    # Streams SSE events live to terminal:
    #   [10:14:23] node_started   receive-request    (system)
    #   [10:14:23] node_completed receive-request    240ms
    #   [10:14:24] node_started   kyc-refresh        (svc-acct-kyc-...)
    #   [10:14:27] node_completed kyc-refresh        3.4s
    #   [10:14:27] node_routed    → ofac-screen      (confidence 0.94 ≥ 0.85)
    #   ...
    #   [10:14:42] node_paused    final-accept       (waiting for human task)
    #
    # Returns the run_id; exits when run completes or hits a terminal
    # state. With --no-stream, returns immediately after starting.
    ```

12. **Inspect a run.**
    ```bash
    atom runs list --workflow ats-asset-transfer
    # Recent runs: id, status, started_at, duration

    atom runs get run-9f3a...
    # Full event timeline with actor types color-coded

    atom runs replay run-9f3a...
    # Re-streams the run's events from MinIO audit log
    ```

13. **HITL task commands.**
    ```bash
    atom tasks list
    # Open tasks: id, workflow, run_id, assignee_group, age, SLA

    atom tasks list --status resolved --since "1 day ago"

    atom tasks get TASK-A3F9B2C1
    # Full task detail incl. agent draft

    atom tasks resolve TASK-A3F9B2C1 --action accept
    atom tasks resolve TASK-A3F9B2C1 --action reject
    atom tasks resolve TASK-A3F9B2C1 --action edit \
      --edits '{"confidence": 0.95, "recommendation": "PASS"}'
    # Workflow resumes
    ```

14. **`atom status` — health check.**
    ```bash
    atom status
    ```
    Hits `/health` on every service. Output:
    ```
    ✓ litellm           4000   ok    (Gemini reachable, virtual key issuance ok)
    ✓ builder-backend   8080   ok    (4 agents registered)
    ✓ workflow-backend  8082   ok    (3 workflows registered, 1 worker)
    ✓ temporal          7233   ok    (default namespace, 1 worker connected)
    ✓ minio             9000   ok    (5 buckets, audit-logs locked 90d)
    ✓ studio            3000   ok
    ✓ reme              8002   ok
    ✓ kyc-svc           8095   ok
    ...
    ```
    Useful before every rehearsal.

15. **`atom demo` — pre-flight.**
    ```bash
    atom demo preflight
    ```
    Runs three demo paths against ATS workflow non-interactively:
    - Auto-resolves human tasks with default actions after 5s wait
    - Reports pass/fail per path
    - Saves a transcript to `docs/rehearsal-log/<timestamp>.txt`

    Use this before every rehearsal session.

16. **CLI demo flow (rehearse this).**
    Use the CLI alongside the UI in the demo:
    ```bash
    # The "developer experience" moment
    atom agent scaffold loan-eligibility --domain banking-credit
    # Show the generated stub in editor (split screen)
    # Edit the role file with a focused prompt
    atom agent validate specs/agents/loan-eligibility.yaml
    atom agent deploy loan-eligibility
    # Agent appears in the UI's agent list immediately
    ```
    This sells Mode B as the realistic developer experience: "you don't
    have to use our UI, but if you do, here's what it looks like."

## Definition of Done

- [ ] `pip install -e .` succeeds; `atom --help` shows all commands
- [ ] `atom agent scaffold` creates spec + role files with all 04c
      fields (reasoning_mode, input_schema, sample_prompts)
- [ ] `atom agent validate` calls backend; pretty-prints errors
- [ ] `atom agent deploy` deploys via builder-backend; identity
      issued visibly
- [ ] `atom agent invoke` supports both `--input` (JSON) and
      `--text` (free text) modes
- [ ] `atom workflow init` creates workflow stub with default
      layout, input_schema, sample_inputs placeholders
- [ ] `atom workflow validate` calls backend; surfaces BFSI-invariant
      errors clearly
- [ ] `atom workflow register` registers with Temporal via backend
- [ ] `atom workflow run` streams SSE events to terminal in
      real time
- [ ] `atom workflow run --sample <label>` works with workflows
      that have `metadata.sample_inputs`
- [ ] `atom runs list/get/replay` works
- [ ] `atom tasks list/get/resolve` works; resolving resumes the
      paused workflow
- [ ] `atom status` checks all 14+ services with informative output
- [ ] `atom demo preflight` runs all three ATS paths and reports
      pass/fail
- [ ] CLI demo flow rehearsed at least 3 times alongside the UI flow

## Common pitfalls

- **CLI duplicates backend logic.** It shouldn't. CLI is a thin client.
  If you find yourself writing validation logic in CLI that's also in
  workflow-backend, stop — call the backend.
- **`workflow run` doesn't exit cleanly when the run pauses at human
  task.** It should: print "paused at <node>, task <id>", exit 0.
  User can resume via `atom tasks resolve`.
- **SSE stream drops mid-run on slow terminals.** Use a robust SSE
  client lib (sseclient-py) with auto-reconnect, not raw httpx.
- **`agent invoke --text` ignores the agent's input_schema.** It
  shouldn't. The free-text path goes through the 04c extraction
  adapter on the agent side; CLI just passes the text payload.
- **`demo preflight` exits before all three paths complete.** Sequence
  them; only proceed to next path when previous reports terminal
  state.
- **`status` reports green on a service that's degraded.** Hit a
  meaningful endpoint, not just `/health`. For LiteLLM, do a real
  Gemini call. For workflow-backend, list workflows and confirm
  Temporal connection.

## Cut criteria

If task 04 (frontend) work is dragging and only one of Mode A or
Mode B can be in the demo: keep Mode A in the live demo, mention
Mode B as a slide ("for developers who prefer their own editor").
**Don't cut the CLI from the codebase** — it's a backstop. If the
UI breaks live, you can complete the demo from the terminal with
`atom workflow run --sample` and `atom tasks resolve`.

## What this session does NOT do

- Does not build a TUI (text-based UI). Click output is fine.
- Does not implement Mode C (NL → workflow generation) — that's
  a workflow-backend endpoint
- Does not add CLI-side caching or offline mode
- Does not add a `atom init` for first-time setup — `docker
  compose up` covers that