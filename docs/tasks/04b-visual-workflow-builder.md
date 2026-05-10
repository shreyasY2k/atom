# Task 04b — Visual Workflow Builder

> **Status**: Tasks 01–04 are complete. The Composer surface in task 04
> only renders the ATS workflow (read-only). This task replaces it with
> an actual visual workflow builder — drag nodes, draw connections,
> configure in inspector, save → validate → register → test run with
> input, with a Human-in-the-Loop queue tab.
>
> Sequence: do this AFTER task 03b (workflow-backend). Composer with no
> backend has nothing to validate, register, or run.
>
> Do this BEFORE task 04c (corrections) and BEFORE task 05 (ATS e2e).

## Goal

Five outcomes:

1. **Visual builder** — drag-and-drop canvas with the four node types,
   draw arrows between nodes, position freely. Style: light, minimalist,
   like the existing Builder UI but with a canvas instead of a form.
2. **Inspector panel** — clicking a node opens a config form on the
   right; type-specific fields per node type.
3. **Save → validate → register** — calls workflow-backend endpoints
   built in 03b. Validation errors render inline against the offending
   nodes.
4. **Test Run pane** — generated input form from the workflow's
   `input_schema`, sample-input buttons, "Run" button. Run streams
   live execution; nodes light up as the worker emits SSE events.
5. **HITL Tasks tab** — separate top-level surface; lists open human
   tasks across all workflow runs; resolving a task resumes the
   paused workflow.

## Why this matters

- The product story is "build any workflow visually, replace human
  steps with agents." The Composer being a YAML viewer breaks that
  story the moment a prospect asks "can I build my own?"
- Demoing a live workflow run from inside the same UI you built it in
  is the gesture that lands: build → run → pause → resolve → done,
  all on one screen.
- The HITL queue is the visible proof of "humans stay on the calls
  that matter." Without a UI for it, the human-in-the-loop story is
  abstract.

## Hard rules — do not violate

1. **Use React Flow.** Don't roll your own canvas. Don't use D3 directly.
   React Flow handles drag, connections, viewport pan/zoom, selection.
   Pinned version in `package.json`.
2. **Persist the workflow's visual layout (node positions) in the
   workflow-spec.yaml itself**, under `metadata.layout`. When the
   spec is reloaded, the canvas reproduces the same arrangement. Do
   not put layout in a separate file or in localStorage.
3. **Spec is the source of truth.** Edits in the inspector mutate the
   in-memory spec; the canvas re-renders from the spec; saving writes
   the spec to disk via workflow-backend. Do not maintain canvas state
   independently.
4. **Four node types only.** Palette has exactly: agent, http, decision,
   human_task. No "tool" node, no "subworkflow" node, no "loop" node.
   Resist temptation. The four-node constraint is part of the BFSI
   pitch (auditability + simplicity); breaking it breaks the pitch.
5. **Input form for runs, not chat.** Run pane uses a generated form
   from `input_schema`. Sample-input buttons fill the form. Do NOT
   add a chat-style input here; chat belongs on the Builder Test panel.
6. **Match the existing UI's visual language.** Light, minimalist,
   Atom brand. Don't redesign. The canvas is one new component;
   everything around it stays.

---

## Part A — Composer canvas (visual builder)

### A.1 Layout

Replace the current Composer surface (which renders ATS read-only) with
a three-pane layout:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Workflows / <workflow-name> (v<version>)        [Validate] [Save]  │
├──────────┬───────────────────────────────────────┬──────────────────┤
│          │                                       │                  │
│ Palette  │            Canvas                     │  Inspector       │
│          │                                       │                  │
│ Trigger  │   [drag nodes onto canvas]            │  (selected node  │
│ Agent    │   [draw arrows between nodes]         │   config here,   │
│ HTTP     │   [pan/zoom]                          │   type-specific) │
│ Decision │                                       │                  │
│ Human    │                                       │                  │
│          │                                       │                  │
│          │                                       │                  │
└──────────┴───────────────────────────────────────┴──────────────────┘
                                                                       
[Run pane below — collapsed by default]                                
```

### A.2 Palette

Five draggable items:

- **Trigger** — special node, only one per workflow, represents the
  entry point. Drag onto canvas creates a "trigger" node which is
  visually a node but doesn't add to the spec's node list (the spec's
  first node is the trigger by convention).
- **Agent** — drag onto canvas creates a node of type `agent` with a
  placeholder `agent_ref.name` until configured.
- **HTTP** — type `http`, placeholder URL.
- **Decision** — type `decision`, placeholder expression `True`.
- **Human task** — type `human_task`, placeholder assignee_group.

Visual language:

| Type | Color (light theme) | Icon |
|---|---|---|
| Trigger | gray (`#F1EFE8` fill, `#5F5E5A` stroke) | play |
| Agent | purple (`#EEEDFE` fill, `#534AB7` stroke) | bolt |
| HTTP | blue (`#E6F1FB` fill, `#185FA5` stroke) | settings |
| Decision | amber (`#FAEEDA` fill, `#854F0B` stroke) | diamond |
| Human task | green (`#EAF3DE` fill, `#3B6D11` stroke) | user-check |

Match the existing minimalist style. No drop shadows. Thin borders.

### A.3 Canvas

React Flow with these features:

- Drag a palette item onto canvas → creates a new node at drop position
- Click a node → selects it; inspector shows its config
- Drag from a node's right-edge handle to another node's left-edge
  handle → creates an edge (representing `next:` or a branch)
- For decision nodes: two output handles labeled `true` and `false`,
  each draggable to a target node
- Right-click a node → context menu: Delete, Duplicate, Rename
- Pan with space-drag or middle-click; zoom with scroll
- Mini-map in bottom-right corner (React Flow built-in)

Layout persistence: every node's position `{x, y}` written into the
spec under `metadata.layout.nodes[<node-id>] = {x, y}`. Save writes
this back. Reload reads it.

### A.4 Inspector

Right-pane, scrollable. Header: node ID (editable), type (read-only),
label (editable). Body: type-specific fields.

**Agent inspector**:
- Agent (dropdown of registered agents from
  `GET builder-backend /agents`)
- Version (dropdown of versions for that agent)
- Confidence threshold (number input, 0.0–1.0; null disables routing)
- Fallback node (dropdown of nodes in this workflow, only enabled if
  threshold is set)
- Input mapping (key-value editor; left = agent's expected input field
  from agent's input_schema; right = expression like `ctx.input.customer_id`)
- Output capture (text input, where the agent's output goes in ctx)
- Read-only: agent's reasoning_mode (shown as badge after 04c lands;
  for now, just shows the agent's metadata)

**HTTP inspector**:
- Method (dropdown: GET / POST / PUT / DELETE)
- URL template (text input with `{{ ctx.* }}` interpolation hint)
- Headers (key-value editor)
- Body template (Monaco editor, JSON, only if method != GET)
- Output capture (text input)
- Timeout (number, seconds)
- Retry config (max attempts, backoff)

**Decision inspector**:
- Expression (Monaco editor, single-line, Python expression)
- Show parser feedback inline: green check if AST validates, red error
  with explanation if not
- Branch targets (read-only, derived from outgoing edges; user
  changes targets by redrawing edges)

**Human task inspector**:
- Assignee group (dropdown: ops, compliance, risk-management, audit)
- Title template (text input)
- Description template (textarea, multi-line, supports `{{ ctx.* }}`)
- Actions (multi-select chips: accept, reject, edit; default all three)
- SLA seconds (number input)
- Output capture (text input)

### A.5 Edge handling

Edges represent control flow. When user draws an edge:

- From an agent / http / human_task node: sets the source node's `next`
  field to the target's id
- From a decision node's `true` handle: sets `branches.true` to target
- From a decision node's `false` handle: sets `branches.false` to target

When user deletes an edge: clears the corresponding field. If a node
has no outgoing edge, its `next` is null (i.e., it's a terminal node).

### A.6 Validation feedback

When user clicks "Validate" or "Save":

- POST the spec to workflow-backend `/specs/workflow/validate`
- For each error in the response, find the offending node and render
  a red badge on it: "✗ <error reason>"
- Show all errors in a popup at the top of the canvas, each clickable
  to scroll the canvas to the offending node
- Save is disabled while validation errors exist

### A.7 Top-bar entry points (three modes)

Like the Builder, the Composer surface has three mode tiles at the
top when no workflow is open:

```
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│  AI COMPOSER      │ │  CLI INIT         │ │  EMPTY CANVAS     │
│  (Mode C)         │ │  (Mode B)         │ │  (Mode A)         │
│                   │ │                   │ │                   │
│  Describe in      │ │  Run command:     │ │  Start blank;     │
│  prose; we draft  │ │  atom workflow    │ │  drag nodes from  │
│  workflow-spec    │ │  init <name>      │ │  the palette      │
└───────────────────┘ └───────────────────┘ └───────────────────┘

Recent workflows:
• ats-asset-transfer (v1.0.0)    [Open]
• [empty - none yet]
```

Mode A (Empty Canvas) is the primary path. Mode B is the CLI flow.
Mode C (AI Composer) calls workflow-backend `/specs/workflow/generate`
with the user's prose; the resulting spec opens in the canvas for
review/edit before save. If 03b doesn't yet implement Mode C, hide
the AI tile behind a feature flag.

---

## Part B — Test Run pane (input form + live execution)

### B.1 Run pane layout

A drawer that slides up from the bottom when user clicks "Test Run":

```
┌─────────────────────────────────────────────────────────────────┐
│  Test run: ats-asset-transfer                              [✕]  │
├─────────────────────────────────────────────────────────────────┤
│  Sample inputs:  [Routine $40K]  [High-value $1.2M]  [Stale doc]│
│                                                                 │
│  Input:                                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  transfer_id:    XFER-RT-001                              │  │
│  │  customer_id:    CUST-100442                              │  │
│  │  amount_usd:     40000                                    │  │
│  │  securities:     [{cusip: 912828ZQ6, qty: 1000}]          │  │
│  │  destination:    {institution: Bank B, account_ref: ...}  │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [Edit raw JSON]                                       [Run →]  │
└─────────────────────────────────────────────────────────────────┘
```

### B.2 Form generation

Read the workflow's `input_schema` (JSON Schema). Generate a form:

- `string` → text input
- `number` / `integer` → number input
- `boolean` → checkbox
- `array` → repeater (list with add/remove)
- `object` → nested form
- `enum` → dropdown
- Required fields marked with `*`; missing required → run disabled

"Edit raw JSON" toggle swaps the form for a Monaco JSON editor with
schema validation. Engineers prefer raw; demo runner prefers form.

### B.3 Sample inputs

Workflow-spec gets a new optional field:

```yaml
metadata:
  ...
  sample_inputs:
    - label: "Routine $40K"
      input: { transfer_id: "XFER-RT-001", customer_id: "CUST-100442", ... }
    - label: "High-value $1.2M"
      input: { transfer_id: "XFER-HV-001", customer_id: "CUST-200119", ... }
    - label: "Stale doc"
      input: { transfer_id: "XFER-SD-001", customer_id: "CUST-300577", ... }
```

Each becomes a button. Click → fills the form. Add three sample inputs
to the existing ATS workflow spec.

### B.4 Live execution

When user clicks Run:

- POST input to workflow-backend `/workflows/<name>/runs`, get `run_id`
- Open SSE on `/workflows/<name>/runs/<run_id>/events`
- For each `node_started` event: highlight the node on the canvas with
  a pulsing purple border (or animate as React Flow style change)
- For each `node_completed`: change border to green check; show
  duration as a tooltip
- For each `node_routed`: animate the edge briefly
- For each `node_paused` (human task): change border to orange clock;
  show "waiting for task" text below the node
- When a paused human task is resolved (separately, via the HITL tab),
  the SSE stream continues and the node turns green

### B.5 Run history

Below the run pane, a small list of recent runs for this workflow:

```
Recent runs:
  run-9f3a... · 4m ago · ✓ completed · Routine $40K       [view]
  run-7c2b... · 12m ago · ⏸ paused at compliance-review   [view]
  run-3e1d... · 1h ago · ✗ failed at swift-submit          [view]
```

Click "view" → loads the run's events into the canvas (read-only
playback mode, nodes show as they were at completion).

---

## Part C — HITL Tasks tab

### C.1 Surface

A new top-level tab in the sidebar: **Tasks**. Two sub-views: Open and
Resolved.

```
┌─────────────────────────────────────────────────────────────────┐
│  Tasks                                       [Open] [Resolved]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  TASK-A3F9B2C1   KYC review for CUST-300577               │  │
│  │  ats-asset-transfer · run-9f3a... · ops · 2m ago          │  │
│  │  SLA: 119 min remaining                                   │  │
│  │                                                           │  │
│  │  The KYC agent returned confidence 0.72. Threshold is     │  │
│  │  0.85. Please review and accept, reject, or edit.         │  │
│  │                                                           │  │
│  │  Agent's draft:                                           │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  { "customer_id": "CUST-300577",                    │  │  │
│  │  │    "confidence": 0.72,                              │  │  │
│  │  │    "issues_found": [                                │  │  │
│  │  │      {"code": "DOC_STALE", "severity": "high",      │  │  │
│  │  │       "detail": "Passport from 2018"}               │  │  │
│  │  │    ], ... }                                         │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  │                                                           │  │
│  │  [Accept]   [Reject]   [Edit]    [View workflow run]      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ... more open tasks ...                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### C.2 Data source

Poll `task-queue` (port 8098) for open tasks every 5 seconds. Or use
SSE if task-queue exposes one (extend it if needed; in-memory is fine
for V1).

### C.3 Actions

- **Accept** → POST `/tasks/<id>/resolve` with `{resolution: "accept"}`
  → workflow resumes
- **Reject** → POST with `{resolution: "reject"}` → workflow resumes
  (or terminates, depending on workflow logic; for V1, reject continues
  next node, the workflow handles rejection in subsequent logic)
- **Edit** → opens a modal showing the agent's draft as editable JSON;
  on save, POST with `{resolution: "edit", edits: {...}}` → workflow
  resumes with edited values

### C.4 Resolved tab

Same card layout but shows: who resolved it, when, what action they
took, and the elapsed time vs SLA. Filter by workflow, by date range.

---

## Part D — Tools: web search and file fetch

### D.1 Don't reinvent

Web search and file fetch are exactly what AgentScope's upstream skills
library provides. Don't write our own.

When 04c lands (skills/roles refactor), an agent that needs web search
or file fetch declares it in the spec:

```yaml
agentscope_skills:
  - web_search
  - file_fetch
```

This task does **not** wire these capabilities. It sets the *visual*
groundwork: when an agent node is selected and that agent has
`agentscope_skills` declared, show those as a "Capabilities" chip
group in the inspector.

### D.2 Pre-04c stub

Until 04c lands, `agentscope_skills` may not exist on agent specs. The
inspector falls back to showing the agent's `tools:` list as
capabilities, prefixed with "tool:". Once 04c migrates the schema, the
inspector reads from `agentscope_skills` for upstream capabilities and
`tools:` for domain tools, displayed in two groups.

This means task 04b ships a placeholder for the capability display that
04c populates correctly. That's fine — sequenced changes.

---

## Definition of Done

- [ ] Three-pane Composer (Palette / Canvas / Inspector) replaces the
      old read-only ATS renderer
- [ ] React Flow integrated; nodes drag, edges draw, viewport
      pans/zooms
- [ ] Four node types in palette; each creates a typed node on drop
- [ ] Inspector shows type-specific config; edits mutate the in-memory
      spec
- [ ] Layout persisted in `metadata.layout` of the workflow-spec
- [ ] Save calls workflow-backend `/specs/workflow/validate` then
      `/workflows/<name>/register`; validation errors render inline
      against offending nodes
- [ ] Three-mode entry tiles (AI / CLI / Empty) on Composer landing
- [ ] Run pane: form generated from `input_schema`; sample inputs
      populated from spec; "Edit raw JSON" toggle works
- [ ] Run streams SSE events; nodes light up live as workflow executes
- [ ] Recent runs list works; clicking a past run replays its node
      states
- [ ] Tasks tab (top-level) shows open tasks with full agent draft
      visible; Accept / Reject / Edit actions resolve the task and the
      workflow resumes
- [ ] Resolved tasks tab shows history with filters
- [ ] Inspector shows agent's capabilities (tools / skills) as chips
- [ ] ATS workflow opens in the new Composer with all 9 nodes
      positioned per `metadata.layout`
- [ ] All four nodes manipulable: agent nodes editable, decision node
      editable with expression validation, human_task editable, http
      editable
- [ ] Replace the workflow's "ats-asset-transfer.yaml" entry to include
      `metadata.layout` and `metadata.sample_inputs` (three sample
      inputs)

## Common pitfalls

- **Building canvas state separately from spec state.** Don't. One
  source of truth (the spec). Canvas re-renders from spec. Saves go
  spec → backend.
- **React Flow auto-layout overrides user positions.** Disable
  autoLayout. User drags = user owns position.
- **Edges to nowhere.** When a target node is deleted, dangling edges
  must be cleaned up. React Flow has a built-in for this; use it.
- **The trigger node tries to be a real node.** It's a visual marker
  for "this is where the workflow starts." Don't add it to the spec's
  node list. Render it as a fixed visual element wired to the first
  real node.
- **SSE connection leaks.** When user navigates away from the Run
  pane, close the EventSource. Otherwise concurrent runs accumulate
  open connections.
- **Form generation ignores nested objects.** ATS input has nested
  `securities` (array) and `destination` (object). Make sure the form
  generator handles 1 level of nesting at minimum. Two levels is
  better.
- **Live node animation runs forever if a node hangs.** Set a 60s
  ceiling on the "started but not completed" pulse animation; after
  that, render as "stuck" and let the user see what's happening in
  Temporal UI.
- **HITL queue polling at 5s creates 12 requests/min per open user
  session.** Fine for demo. Replace with SSE in Phase 2 if it matters.
- **Inspector edits don't propagate to the canvas if the canvas
  re-renders from a stale spec.** Ensure the spec is held in a single
  state container (React Context or Zustand) and the canvas subscribes.

## What this task does NOT do

- Does not build agents (that's the Builder UI; already done)
- Does not implement workflow-backend (that's task 03b; must be done
  first)
- Does not implement the chat surface or inline traces (that's 04c)
- Does not change the four node types
- Does not add subworkflows, loops, or parallel forks
- Does not implement Mode C (NL → workflow) — that's a workflow-backend
  endpoint; if 03b ships it, the AI Composer tile calls it; if not,
  the AI tile is hidden behind a feature flag
- Does not change agent behavior
- Does not change identity / audit / Temporal logic