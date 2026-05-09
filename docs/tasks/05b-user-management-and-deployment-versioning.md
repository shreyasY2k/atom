# Task 05b — User Management, Deployment Versioning, and Approval Workflow

> **Status**: Tasks 01–05 are complete. CLI (06) and rehearsal (07) are
> ahead. This task is inserted between 05 and 06 because the CLI's
> commands need to know about the deployment-request flow.
>
> Sequence: 05 → **05b** → 06 → 07.
>
> Platform is rebranded `atom` (was `mphasis-agent-platform`). Rebranding
> is a global find-replace; this task includes the rebrand checklist.

## Goal

Five outcomes:

1. **Three demo users with role-button login**: Builder, Approver,
   Platform Admin. Click a button → become that user. No real auth.
2. **Deployment versioning**: every agent and workflow deploy is a
   versioned, attributed event. Visible in UI per-agent and per-workflow
   as a "Deployments" history tab.
3. **Approval workflow**: Builder clicks Deploy → request goes to
   Approver's queue → Approver approves/rejects/requests-changes → on
   approve, deployment proceeds, BOTH identities recorded.
4. **Platform Admin** has bypass + settings access.
5. **Rebrand to `atom`** propagated through repo, compose file, CLI,
   docs, and UI.

Existing demo paths (ATS routine, high-value, KYC low-confidence) must
continue to work end-to-end after this task. Nothing about the agent
or workflow runtime changes.

## Why this matters

- Banks expect role-based governance on agent deployment. "Anyone can
  deploy an agent into production" is a non-starter for a CISO
  conversation.
- Deployment versioning answers: who deployed this agent, when, from
  what spec, with what approval, and is the audit trail intact?
  These are concrete SOC 2 / SR 11-7 questions; without versioning,
  the answer is "trust us."
- Approval workflow demoed live (Builder → Approver → deploy) gives
  the demo a second visible governance moment beyond identity audit.

## Hard rules

1. **Do not introduce real authentication** in V1. Role-button login
   sets a session cookie naming the role. Document this clearly as
   demo-grade; production uses IDP integration.
2. **Do not enforce RBAC at the API layer** in V1. Backends trust the
   `X-Atom-Actor` header set by the UI. Document this clearly. Phase 2
   adds gateway-level enforcement.
3. **Three roles only**: Builder, Approver, Platform Admin. Adding more
   is scope creep and confuses the demo.
4. **Approval workflow is per-deployment, not per-spec-edit.** Editing
   a YAML in the Composer or Builder doesn't trigger approval. Clicking
   Deploy does.
5. **Platform Admin is the bypass, not the default.** The demo's main
   storyline uses Builder → Approver. Platform Admin is shown briefly
   to demonstrate it exists; do not run the entire demo as Platform
   Admin.
6. **Existing audit logs for LLM calls, tool calls, workflow runs are
   not touched.** Add new audit categories for deploy_request,
   approval, rejection, but don't refactor what already exists.
7. **Deployment requests are real persistent state**, not in-memory.
   Stored in a new table/bucket so they survive container restart.

---

## Part A — Roles, identity, and session model

### A.1 Three roles

| Role | Identity | Can do |
|---|---|---|
| `builder` | `user:builder@atom.demo` | Build agents and workflows; submit deployment requests; see own work + approved deployments |
| `approver` | `user:approver@atom.demo` | Build (optional); approve/reject/request-changes on requests; deploy directly (own builds and approved requests); see all |
| `platform_admin` | `user:admin@atom.demo` | All of the above; bypass approval; access settings (registry, feature flags) |

Identities are pre-seeded; no signup flow. Three database rows in a
new `users` table in builder-backend's existing Postgres (reuse
litellm-db's instance for V1 simplicity, separate database name
`atom_users`).

### A.2 Login surface

A login screen at `/login` shown when no session cookie exists:

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│              atom platform                               │
│                                                          │
│         Choose a role to log in as:                      │
│                                                          │
│         ┌──────────────────────┐                         │
│         │  Builder             │                         │
│         │  Build agents and    │                         │
│         │  workflows; submit   │                         │
│         │  for approval        │                         │
│         └──────────────────────┘                         │
│                                                          │
│         ┌──────────────────────┐                         │
│         │  Approver            │                         │
│         │  Review deployment   │                         │
│         │  requests; approve   │                         │
│         │  or reject           │                         │
│         └──────────────────────┘                         │
│                                                          │
│         ┌──────────────────────┐                         │
│         │  Platform Admin      │                         │
│         │  Full access; bypass │                         │
│         │  approval            │                         │
│         └──────────────────────┘                         │
│                                                          │
│         (V1: demo role simulation; production uses       │
│          your IDP — Okta, Azure AD, or equivalent)       │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Click a role → POST `/auth/login` with `{role}` → backend sets
session cookie `atom_session=<role>` → redirect to home.

### A.3 Session and identity propagation

Session cookie carries the role. The frontend reads it and:
- Shows the current user in the top bar (name + role badge)
- Conditionally renders UI elements based on role
- Sends `X-Atom-Actor: user:<role>@atom.demo` header on every API
  call (this is the audit identity)

Backends (builder-backend, workflow-backend) read `X-Atom-Actor`,
record it as `actor_id` in audit events. Trust the header (V1).

### A.4 Logout

Top-right user menu has "Log out" → clears cookie → back to /login.
Helpful during the demo for the role-switching gesture.

### A.5 Update existing audit calls

Every existing audit emission that hardcodes
`actor_id: user:demo@mphasis.com` is updated to read from the request
context's `X-Atom-Actor` header. Behavior is otherwise unchanged.

---

## Part B — Deployment versioning

### B.1 Concept

Every agent and workflow has a *deployment history*. Each entry is an
immutable record of one deploy attempt:

```
deployment_id: dep-<uuid>
target_type: agent | workflow
target_name: <name>
target_version: <semver from spec>
spec_hash: sha256:...
code_hash: sha256:... (for agents only)
requested_by: user:builder@atom.demo
requested_at: 2026-05-09T...
approval_status: pending | approved | rejected | bypassed | n/a
approved_by: user:approver@atom.demo | null
approved_at: timestamp | null
deploy_status: pending | deploying | deployed | failed | undeployed
deployed_at: timestamp | null
deploy_error: string | null
service_account_id: svc-acct-... | null  (agent only)
notes: string  (any: requestor's note, approver's comment, error msg)
```

Stored in MinIO under `atom-deployments/<target_type>/<target_name>/`
as JSON files. Object lock NOT applied (these get updated on
state transitions). Audit events of state transitions go to
`audit-logs/deployment/...` which IS object-locked.

### B.2 New backend endpoints (builder-backend)

| Method | Path | Role required | Purpose |
|---|---|---|---|
| `POST` | `/agents/<name>/deploy-request` | builder, approver, admin | Submit a deployment request |
| `GET` | `/deployments` | any | List all deployment requests (filterable by status, target, requester) |
| `GET` | `/deployments/<id>` | any | Get a request's full record |
| `POST` | `/deployments/<id>/approve` | approver, admin | Approve; triggers actual deployment |
| `POST` | `/deployments/<id>/reject` | approver, admin | Reject with reason |
| `POST` | `/deployments/<id>/request-changes` | approver, admin | Send back with comments; requester can resubmit |
| `POST` | `/agents/<name>/deploy-direct` | admin only | Bypass approval; deploy immediately |
| `GET` | `/agents/<name>/deployments` | any | History for one agent |

Mirror the same shape under `/workflows/` in workflow-backend:
`/workflows/<name>/deploy-request`, `/workflows/<name>/deployments`,
etc. Approve/reject endpoints can live in either backend; for
simplicity put them all in builder-backend (it's the source of truth
for the deployments collection) and have workflow-backend POST to it.

### B.3 Approval flow logic

**Approver clicks Approve on a request:**

1. Verify role is `approver` or `platform_admin` (read header)
2. Mark request as `approved`, record approver identity + timestamp
3. Trigger the actual deployment using existing
   `/agents/<name>/deploy` (or workflow equivalent), with the deploy
   identity carrying both the requestor (as owner) and approver
   (as approver)
4. Update request as `deployed` on success or `failed` with error
5. Emit audit events for: approval, deploy start, deploy complete

**Approver clicks Reject:**

1. Mark request as `rejected`, record approver identity + reason
2. Emit audit event
3. Done — agent is not deployed; requestor sees rejection in UI

**Approver clicks Request Changes:**

1. Mark request as `changes_requested`, record approver identity +
   comments
2. Builder sees the request in their queue with comments; they edit
   the spec and click Deploy again, which creates a new request with
   `previous_request_id` linking to the changed-back one
3. Audit chain: each request links to predecessor; full history
   reviewable

### B.4 Platform Admin bypass

Platform Admin sees every Deploy button as direct (no submit-for-
approval). When they click Deploy, the request is created with
`approval_status: bypassed`, `approved_by: <admin>`, and deployment
proceeds immediately. **Audit event labels this clearly as
"bypass deploy"** — banks want this visible, not hidden.

### B.5 What about updates to a deployed agent?

Re-deploying an existing agent (new version of the spec) is a new
deployment request. The history shows the chain:
v1.0.0 deployed → v1.0.1 requested → approved → deployed → ...

Undeploying (removing an agent) is also an event in the history but
does not require approval (any role can undeploy their own agents;
admin can undeploy any). This is a deliberate asymmetry: turning
something off is safer than turning something on.

---

## Part C — UI surfaces

### C.1 Top bar — current user and role badge

Top-right of every page:

```
                                    [Builder] User: builder@atom.demo ▾
```

Click the dropdown → Logout.

Role badge color: Builder = neutral gray, Approver = blue, Platform
Admin = purple.

### C.2 Builder UI — deployment request flow

Replace the Deploy button on agents and workflows with role-aware
behavior:

**As Builder:**
- Button labeled "Submit for Deployment" (not "Deploy")
- Click → modal with optional note for the approver → Submit
- After submit: card showing "Deployment request submitted; waiting
  for approval" with link to the request detail
- Builder cannot deploy directly

**As Approver:**
- Button labeled "Deploy" — directly deploys (no approval needed
  for own builds; approving someone else's request happens in
  Approvals tab below)

**As Platform Admin:**
- Button labeled "Deploy (bypass approval)" with subtle styling
  to mark it as bypass

### C.3 New top-level surface: Approvals

Visible in sidebar when role is `approver` or `platform_admin`. (Hidden
for Builder — they don't approve.)

```
┌──────────────────────────────────────────────────────────────────┐
│  Approvals                                          [Pending] [Resolved]
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  dep-A1B2C3D4   Agent: kyc-refresh v1.0.1                  │  │
│  │  Requested by builder@atom.demo · 2 min ago                │  │
│  │                                                            │  │
│  │  Note from requester:                                      │  │
│  │    "Updated the confidence rubric per compliance feedback. │  │
│  │     Now lowers confidence below 0.85 if any document is    │  │
│  │     beyond 730 days old."                                  │  │
│  │                                                            │  │
│  │  Spec diff (v1.0.0 → v1.0.1):                              │  │
│  │    [collapsed; click to expand inline diff]                │  │
│  │                                                            │  │
│  │  [Approve] [Request Changes] [Reject] [View full spec]     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ... more pending requests ...                                   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Resolved tab shows past approvals/rejections with filter by date,
target, approver.

### C.4 Deployments tab on each agent/workflow detail page

Add a new tab to existing agent and workflow detail views:

```
┌─────────────────────────────────────────────────────────────────┐
│  kyc-refresh                                                     │
│  Overview | Test | Deployments | Audit                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Deployment history:                                             │
│                                                                  │
│  v1.0.1 ✓ deployed                                               │
│    Requested by builder@atom.demo at 2026-05-09 10:14            │
│    Approved by approver@atom.demo at 2026-05-09 10:18            │
│    Deployed at 2026-05-09 10:18:42                               │
│    Service account: svc-acct-kyc-refresh-b7c2d4                  │
│    Spec hash: sha256:8a3f2...                                    │
│    [View spec] [View approval thread]                            │
│                                                                  │
│  v1.0.0 ✓ deployed (currently undeployed)                        │
│    Requested by builder@atom.demo at 2026-05-08 15:22            │
│    Approved by approver@atom.demo at 2026-05-08 15:26            │
│    Deployed at 2026-05-08 15:26:11                               │
│    Undeployed at 2026-05-09 10:18:42 (replaced by v1.0.1)        │
│    [View spec] [View approval thread]                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Each entry expandable; "View approval thread" shows the request → note
→ approval comments → deploy events as a vertical timeline.

### C.5 Platform Admin: settings panel

New surface visible only to Platform Admin in sidebar:

```
Settings
├─ Users (read-only list of three demo users)
├─ Roles (read-only list of three roles + their permissions)
├─ Feature flags
│   - AI Composer (Mode C): on/off
│   - Web search for agents: on/off
│   - Free-text input adapter: on/off
├─ Audit retention (read-only; shows COMPLIANCE 90d)
└─ Service health (links to atom status output)
```

Most of this is read-only. Feature flags toggle real flags in
backends. Settings exists to give the demo a "look, the platform admin
can configure things" moment without building out a full admin UI.

### C.6 Builder UI — "My requests" view

For Builders only: a small "My Requests" widget on the home page
showing their pending and recently-resolved requests:

```
My deployment requests:
  dep-A1B2C3D4  agent kyc-refresh v1.0.1  · pending   (2 min ago)
  dep-9F2E8C1B  workflow ats-v2 v1.0.0    · approved  (yesterday)
  dep-3D7A5B2C  agent triage v0.9.0       · changes-requested (3d ago)
```

Click → request detail page with the approver's comments.

---

## Part D — CLI updates

The 06 task file already exists; this section adds what the CLI needs
to know about deployment requests.

### D.1 New commands

```bash
# Login (sets ~/.atom/session, role from arg)
atom login --as builder
atom login --as approver
atom login --as admin
atom whoami         # prints current role
atom logout

# Deployment requests
atom deployments list                      # all requests
atom deployments list --status pending     # filter
atom deployments list --requester me
atom deployments get dep-A1B2C3D4          # detail
atom deployments approve dep-A1B2C3D4 --note "looks good"
atom deployments reject dep-A1B2C3D4 --reason "rubric not specific enough"
atom deployments request-changes dep-A1B2C3D4 --comments "..."

# Per-target history
atom agent history kyc-refresh             # deployment history for one agent
atom workflow history ats-asset-transfer
```

### D.2 Updated `agent deploy` and `workflow register` commands

When called as Builder: submits a deployment request, returns the
`request_id`, exits 0.

When called as Approver: behaves as before (direct deploy of own
work).

When called as Admin: behaves as before (direct deploy with bypass
flag).

The 06 task file should be updated to reflect this; do that update
as part of Part F below.

---

## Part E — Audit chain

### E.1 New audit event types

Add to `minio://audit-logs/deployment/`:

| Event | Actor | Triggered when |
|---|---|---|
| `deployment_requested` | builder/approver/admin | Request created |
| `deployment_approved` | approver/admin | Request approved |
| `deployment_rejected` | approver/admin | Request rejected |
| `deployment_changes_requested` | approver/admin | Request sent back |
| `deployment_started` | system | Actual deploy begins (after approval) |
| `deployment_completed` | system | Deploy succeeded |
| `deployment_failed` | system | Deploy failed; record error |
| `deployment_bypassed` | admin | Admin used bypass (special audit visibility) |
| `agent_undeployed` / `workflow_unregistered` | builder/approver/admin | Undeploy event |

All events include `target_type`, `target_name`, `target_version`,
`deployment_id`, and the actor.

### E.2 Approval thread visualization

In the deployment detail view, show the audit events as a vertical
thread:

```
○ requested by builder@atom.demo                  10:14:22
  "Updated the confidence rubric..."
│
○ approved by approver@atom.demo                  10:18:01
  "looks good"
│
○ deploy started (system)                         10:18:01
│
○ deploy completed (system)                       10:18:42
  service-account svc-acct-kyc-refresh-b7c2d4 issued
```

This is the demo's "see, every change is attributed and reviewable"
moment.

---

## Part F — Rebrand to `atom`

Sweep the repo for the old name. This is mostly mechanical but
non-trivial — touches several files.

### F.1 Find-replace targets

1. `mphasis-agent-platform` → `atom-agent-platform` (or just `atom`
   in user-facing strings; keep the longer name only in directory
   names if convenient)
2. `mphasis` → `atom` in:
   - `CLAUDE.md`
   - `README.md`
   - `docker-compose.yml` (container names)
   - `cli/mphasis.py` → rename to `cli/atom.py`; update setup.py
     entry point `console_scripts: ["atom=atom:cli"]`
   - All `docs/*.md` files
   - All `docs/tasks/*.md` files
   - Frontend strings (titles, headers, page titles)
   - Backend service names where they appear in audit logs
   - Image tags if any are namespaced
3. Email domains in seeded users: `@atom.demo` (already in this file)
4. URLs anywhere internal: stay as-is (localhost ports unchanged)

### F.2 Don't rebrand

- Anthropic, AgentScope, Temporal, LiteLLM, MinIO names — these are
  upstream tools, keep their names
- Mphasis the company itself, where mentioned (e.g. "Mphasis BFSI
  team", "Mphasis sales") — that's the parent; the platform is `atom`
- The legal phrase "Mphasis Agent Platform" if used in any
  marketing/leave-behind copy — that's a product naming question for
  Mphasis branding, not for this technical rebrand

### F.3 Verify after sweep

- `grep -ri "mphasis" .` returns nothing in code/docs
- `docker compose up` works with renamed containers
- CLI invocable as `atom` (not `mphasis`)
- All existing demo paths still pass `atom demo preflight`

---

## Part G — Updates to other task files

### G.1 Update `docs/tasks/06-cli.md`

Already partially started (you renamed mphasis→atom). Add a section
under "Steps" between current step 5 and 6:

```
5b. **Deployment request flow** (depends on task 05b)
    ```bash
    # As Builder
    atom login --as builder
    atom agent deploy demo-agent
    # Output: "Submitted deployment request dep-A1B2C3D4 for agent
    #  demo-agent v0.1.0; waiting for approval"
    atom deployments list --requester me

    # As Approver
    atom login --as approver
    atom deployments list --status pending
    atom deployments approve dep-A1B2C3D4 --note "approved"

    # Back as Builder, see it deployed
    atom login --as builder
    atom agent history demo-agent
    ```
```

### G.2 Update `docs/tasks/07-rehearsal.md`

Demo script update — the workflow build segment now has a role-switch
moment. Insert into the script timing (rebalance to 15 min if needed,
or compress earlier sections):

```
6:00–7:30 — Show governance (NEW SEGMENT)
- Build the workflow as Builder; click Deploy → request submitted
- Top bar role-switch to Approver
- Open Approvals tab, single pending request
- Show the spec diff, the requester's note
- Click Approve → workflow deploys
- "Same gesture an actual bank ops team would use. Builder produces;
   approver attests; deploy happens with both identities recorded.
   Same flow for agents."
- Switch back to Builder for the run
```

Add to Q&A doc:

26. **"How do you handle change management on agent updates?"** Every
    deploy is a versioned, attributed request. Builder submits;
    Approver reviews the diff and notes; on approve, deploy executes
    with both identities in audit. Rejected and request-changes flows
    are also tracked. Full audit chain visible per agent.
27. **"What about emergency deploys when there's no time for review?"**
    Platform Admin has bypass authority. Bypass deploys are visibly
    labeled in the audit log so they're reviewable after the fact.
    Banks typically want this audit visibility, not its absence.
28. **"How does this integrate with our IAM?"** V1 is role simulation
    for the demo. Production replaces the role-button login with your
    IDP (Okta, Azure AD); roles map to your existing groups; deployment
    requests can route through your existing change-management system
    (ServiceNow, JIRA) via webhook in Phase 2.
29. **"Can the approver see what changed?"** Yes — approval view shows
    inline spec diff between current deployed version and requested
    version, plus the requester's note. Same for workflows.
30. **"What's the audit chain look like in production?"** Same as in
    the demo, plus IDP correlation: requester and approver are the
    bank IAM identities, not local roles. Deploy events carry session
    IDs from the IDP for end-to-end tracing.

---

## Part H — Demo seeding

### H.1 Pre-seeded state for the demo

Before each rehearsal:
- The three users exist
- ATS workflow + 4 ATS/treasury/insurance agents already deployed
  (under Approver identity, history shows clean approval chain from
  pre-demo seed)
- One pending deployment request seeded (e.g., a v1.0.1 of kyc-refresh
  with a small rubric change) — this becomes the Approval moment in
  the live demo
- Builder's "My Requests" widget shows the seeded pending request

`atom demo preflight` should reset to this state. Add the seed logic
to a new `scripts/seed-demo-state.sh`.

---

## Definition of Done

- [ ] Three roles defined; users seeded in builder-backend's database
- [ ] Login screen renders and three role buttons work; session
      cookie set; UI redirects appropriately
- [ ] All API calls send `X-Atom-Actor` header; backends record it as
      audit identity
- [ ] All existing audit emissions updated to use header value (no
      hardcoded `user:demo@mphasis.com`)
- [ ] Deployment versioning data model implemented; storage in
      MinIO + audit chain in audit-logs (locked)
- [ ] All deployment endpoints implemented in builder-backend and
      workflow-backend
- [ ] Approval workflow functional: request → approve → deploy works;
      reject and request-changes flows work
- [ ] Platform Admin bypass works and is visibly labeled
- [ ] UI: top-bar shows current user with role badge color-coded
- [ ] UI: Builder sees "Submit for Deployment"; Approver sees "Deploy";
      Admin sees "Deploy (bypass)"
- [ ] UI: Approvals top-level surface with Pending/Resolved tabs (only
      visible to Approver/Admin)
- [ ] UI: Deployments tab on every agent/workflow detail page
- [ ] UI: My Requests widget on Builder home page
- [ ] UI: Settings panel for Platform Admin
- [ ] Approval thread visualization on each deployment detail page
- [ ] CLI: login/whoami/logout works
- [ ] CLI: deployments list/get/approve/reject/request-changes works
- [ ] CLI: agent deploy and workflow register submit requests when run
      as Builder
- [ ] All existing demo paths (ATS routine, high-value, KYC low-conf)
      still pass `atom demo preflight`
- [ ] Repo rebranded from `mphasis` to `atom` across all targets in F.1
- [ ] `grep -ri "mphasis" .` returns no hits in code/docs (excluding
      legitimate references to Mphasis the company)
- [ ] `docs/tasks/06-cli.md` updated with deployment request commands
- [ ] `docs/tasks/07-rehearsal.md` updated with governance demo segment
      and Q&A 26–30
- [ ] Pre-seed script populates demo state including one pending
      approval request
- [ ] All 5 rehearsal columns (Path A, B, C, agent build, workflow
      build) still green; new column "Approval flow" tracked

## Common pitfalls

- **Builder can edit the request after submit.** Don't allow this.
  Once submitted, the request is immutable; Builder must withdraw and
  resubmit, OR Approver requests changes which creates a new request.
  Mutation = audit hole.
- **Approval auto-deploys synchronously.** Don't. Approval queues the
  deploy as an async job; the approver's response returns immediately.
  Otherwise the approve API call blocks for tens of seconds while
  containers spin up.
- **Spec diff visualization is too clever.** A simple side-by-side
  YAML diff (highlighted line by line) is enough. Don't ship a fancy
  semantic diff in V1.
- **Three demo users get out of sync after rehearsal.** Always run
  `atom demo preflight` to reset; the seed script clears stale
  requests and re-seeds the canonical state.
- **Header `X-Atom-Actor` trusted unconditionally.** Yes, that's the
  V1 design. Document it loudly. Production has gateway-level
  enforcement; in V1, anyone hitting the API directly with a forged
  header is a non-attack-surface (single-host demo).
- **Rebrand misses container names in compose; old containers linger
  in Docker.** After rebrand, run `docker compose down --remove-orphans`
  before bringing up renamed services.
- **CLI session storage `~/.atom/session` collides between roles.**
  CLI session is one role at a time. Switching roles in CLI is a
  logout + login, not a multi-session model.
- **Pre-seed leaves orphaned approval requests.** The seed script
  must wipe `atom-deployments/` bucket before re-seeding; otherwise
  Approvals tab fills with stale entries.

## What this task does NOT do

- Real authentication (passwords, JWTs, OAuth, IDP integration)
- API-layer RBAC enforcement (V1 trusts UI's claims)
- Multi-tenant model
- User signup, profile editing, password reset
- Notification system (email/Slack alerts on approval requests) —
  Phase 2
- Approval routing rules (auto-route based on agent domain) — Phase 2
- Audit log signing or chain-of-custody verification beyond MinIO
  object lock
- Approval delegation (approver-of-the-week rotations) — Phase 2

## Cut criteria

If, by midpoint of this task, anything in 04b or 04c is broken, stop
this task and fix the prerequisite first. User management on a broken
Composer is wasted work.

If the approval flow's UI proves complex, ship it CLI-first: CLI
commands fully working, UI shows minimal Approvals tab without diff
view; the demo runs from the CLI for the approval moment with the
UI showing state changes after.