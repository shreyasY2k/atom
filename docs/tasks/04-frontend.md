# Task 04 — Frontend (Builder + Composer + Audit + Tasks)

## Goal

Single React SPA with **four surfaces** behind a left sidebar. The Composer canvas is the demo's visual anchor — it must look and feel professional.

## Stack

- React 18 + Vite + TypeScript
- Tailwind for styling
- React Flow for the Composer canvas
- Monaco editor for YAML / spec editing
- TanStack Query for API calls
- React Router v6 for the four surfaces
- EventSource for SSE event subscription on workflow runs

## Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ATOM Agent Platform                          user: demo ▾   │
├──────────┬──────────────────────────────────────────────────────┤
│          │                                                       │
│  HOME    │   [content for current surface]                       │
│          │                                                       │
│  AGENTS  │                                                       │
│   Build  │                                                       │
│   List   │                                                       │
│          │                                                       │
│  WORK-   │                                                       │
│  FLOWS   │                                                       │
│   Compose│                                                       │
│   List   │                                                       │
│   Runs   │                                                       │
│          │                                                       │
│  TASKS   │                                                       │
│   Open   │                                                       │
│   Resolved│                                                      │
│          │                                                       │
│  AUDIT   │                                                       │
│   Events │                                                       │
│   Identi-│                                                       │
│   ties   │                                                       │
└──────────┴──────────────────────────────────────────────────────┘
```

## Surface 1: Agent Builder (`/agents/build`)

Three mode tiles at the top. Selecting one swaps the panel below.

```
┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐
│   AI BUILDER       │  │   CLI SCAFFOLD     │  │   EDIT YAML        │
│                    │  │                    │  │                    │
│   Describe in      │  │   Run command in   │  │   Start from a     │
│   plain English;   │  │   terminal; stub   │  │   template; edit   │
│   we generate      │  │   appears in repo  │  │   in Monaco        │
│   spec + skill     │  │                    │  │                    │
└────────────────────┘  └────────────────────┘  └────────────────────┘
```

### AI Builder mode

- Large textarea: "Describe the agent you want to build"
- Generate button → POST `/specs/agent/generate`
- Side-by-side review: spec YAML on left (Monaco, editable), skill markdown on right (Monaco, editable)
- "Validate" button → POST `/specs/agent/validate`
- "Deploy" button → POST `/agents/{name}/compile` then `/agents/{name}/deploy`
- After deploy: card showing the agent's record with **service-account ID prominently displayed**

### CLI Scaffold mode

- Static panel with copy-paste command:
  ```
  atom agent scaffold <agent-name> --domain <domain>
  ```
- Below: a list of agents currently in `specs/agents/` (polled from builder-backend) with "Deploy" buttons
- This is Mode B — what a developer would actually do

### Edit YAML mode

- Dropdown of templates (treasury, kyc, recon, custom)
- Monaco editor with YAML schema validation
- Same Validate / Deploy flow

## Surface 2: Workflow Composer (`/workflows/compose/{name}`)

Three panes:

| Pane | What it contains |
|---|---|
| Left: Palette | Five buttons: Trigger, Agent, HTTP/MCP, Decision, Human Task. Drag onto canvas. |
| Center: Canvas | React Flow graph. Nodes have type-specific colors and icons. Edges are directed. |
| Right: Inspector | Properties of the selected node. Type-specific config editor. |

Top toolbar: workflow name + version, [Validate] [Save] [Register] [Run] buttons.

### Node type styling

| Type | Color | Icon | Notes |
|---|---|---|---|
| `trigger` | gray | ▶ | Visual only; the workflow's first node |
| `agent` | purple | ⚡ | Shows agent name + service-account ID badge |
| `http` | blue | ⚙ | Shows method + URL excerpt |
| `decision` | yellow | ◇ | Shows expression |
| `human_task` | green | 👤 | Shows assignee group + SLA |

### The central demo gesture

Clicking an `http` or `human_task` node opens Inspector with a "Replace with agent" button. Clicking it shows a dropdown of agents from the registry. Selecting one converts the node to type `agent` with appropriate config. **This is what the demo runner does live.**

### Run pane

Bottom drawer that opens when "Run" is clicked. Shows:

- Sample payload selector: routine ($40K) | high-value ($1.2M) | confidence-breach
- "Run" button → POST `/workflows/{name}/runs`, opens SSE stream on `/runs/{run_id}/events`
- Live timeline: each node lights up as it starts; shows duration when it completes; shows confidence score on agent nodes; shows "paused — waiting for task" on human_task nodes
- Link to the audit pane filtered to this run

## Surface 3: Tasks (`/tasks`)

Two tabs: Open / Resolved.

Open tasks list (cards):

```
┌──────────────────────────────────────────────────────────────┐
│ TASK-A3F9B2C1    KYC needs human review for CUST-300577      │
│ ops · created 2m ago · SLA in 119 min                        │
│                                                               │
│ The KYC agent returned confidence 0.72. Threshold is 0.85.   │
│ Please review the agent's draft KYC and accept, reject,      │
│ or edit.                                                      │
│                                                               │
│ Agent's draft: { "customer_id": "CUST-300577", ... }         │
│                                                               │
│ [Accept]  [Reject]  [Edit]                                   │
└──────────────────────────────────────────────────────────────┘
```

Click an action → POST `/tasks/{id}/resolve` → workflow resumes.

## Surface 4: Audit (`/audit`)

Filterable timeline of events across all sources.

### Filter chips at top

- Date range
- Actor type: `agent` / `human` / `system`
- Actor ID (free text)
- Event type
- Workflow run ID

### Event row

```
┌──────────────────────────────────────────────────────────────┐
│ 10:14:23.482  [AGENT] svc-acct-kyc-refresh-a3f9b2c1          │
│ LLM call · gemini-3.1-pro · run-9f3a... · node kyc-refresh   │
│ 1,240 input tokens · 380 output tokens · 3.4 sec             │
└──────────────────────────────────────────────────────────────┘
```

Three actor-type colors: agent (purple), human (blue), system (gray). The visual distinction is what sells the NHI talk track.

### Identities tab (`/audit/identities`)

A separate view listing all known service-account IDs with: agent they belong to, owner, deployed date, # calls, # tokens, status (active / revoked).

## Definition of Done

- [ ] All four surfaces routable and load without errors
- [ ] Agent Builder AI mode generates a spec from prose and shows it in editable form
- [ ] Agent Builder CLI mode shows the command and lists scaffolded agents
- [ ] Workflow Composer renders the ATS workflow when loaded with `ats-asset-transfer.yaml`
- [ ] Inspector shows correct fields per node type
- [ ] "Replace with agent" gesture works
- [ ] Validate / Save / Register / Run buttons all work end-to-end
- [ ] Run pane lights up nodes as SSE events arrive
- [ ] Tasks pane shows open tasks and accepting one resumes a paused workflow
- [ ] Audit pane shows events with three distinct actor types color-coded
- [ ] Identities pane lists service-account IDs

## Visual quality bar

This is on the demo's visual critical path. Spend the time to:

- Pick a tight color palette (don't use stock Tailwind defaults — looks template-y)
- Use a modern monospaced font for IDs and YAML (JetBrains Mono or similar)
- Animate node state transitions on the Composer canvas (subtle pulse on "started", checkmark on "completed")
- Make the service-account ID badge a deliberate visual element — that's the talk-track anchor

If frontend is slipping, the cut is: drop animations, drop the Audit identities tab, keep everything else.
