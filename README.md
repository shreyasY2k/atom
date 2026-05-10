# ATOM Agent Platform — TechShift Demo

A two-surface platform for BFSI process automation:

- **Agent Builder** — builds audited, deployable AI agents from a versioned spec.
- **Workflow Composer** — loads existing BFSI workflows; replaces routine human steps with agents; keeps humans on decisions that matter.

Stack: **Gemini-only · AgentScope + Temporal · LiteLLM gateway · MinIO audit with object lock**

Flagship demo: **Asset Transfer Service (ATS)** — a 9-step US bank securities workflow with two agent-replaced nodes.

---

## 1. Prerequisites

- Docker + Docker Compose (Docker Desktop ≥ 4.x)
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Python 3.9+ (for the CLI, optional)

---

## 2. First-time setup

```bash
# Clone (or pull latest)
git clone https://github.com/shreyasY2k/agent-platform.git
cd agent-platform

# Copy env template and set your Gemini key
cp .env.example .env
# Edit .env and set: GEMINI_API_KEY=your-key-here

# Build all images (~10–15 min first time; builds AgentScope, Studio, ReMe from source)
docker compose build

# Start the stack
docker compose up -d

# Verify all services are healthy
docker compose ps
```

> **Rebuilding after a previous run?** Run `docker compose down --remove-orphans` before `up` to clear containers from the old project name.

---

## 3. Surface URLs

| Surface | URL | Default creds |
|---|---|---|
| **ATOM Platform UI** (Builder + Composer) | http://localhost:5173 | role-button login (no password) |
| AgentScope Studio (agent traces) | http://localhost:3000 | — |
| Temporal Web UI (workflow runs) | http://localhost:8233 | — |
| MinIO console (audit logs) | http://localhost:9001 | `minioadmin` / `minioadmin` |
| LiteLLM dashboard (LLM calls + virtual keys) | http://localhost:4000/ui | `sk-atom-demo-master-2024` |
| Grafana (logs + traces) | http://localhost:3001 | `admin` / `admin` |

---

## 4. Deploy agents and register the workflow

After every fresh `docker compose up`, the agent containers are not running (they're built on demand). Deploy them:

### Via CLI

```bash
# Install the CLI (one-time)
pip3 install -e cli/

# Log in as Platform Admin (bypass approval for fast setup)
atom login --as admin

# Deploy all 4 ATS agents
atom agent deploy kyc-refresh
atom agent deploy asset-recon
atom agent deploy transaction-anomaly-triage
atom agent deploy treasury-liquidity-briefing

# Register the ATS workflow
atom workflow register ats-asset-transfer

# Verify
atom agent list
```

### Via UI

1. Open http://localhost:5173 → log in as **Platform Admin**
2. Go to **Agents → Registry** → click **Deploy (bypass)** on each agent card
3. Go to **Workflows → Registry** → click **Re-register** on the ATS workflow

### Via curl (scriptable)

```bash
for AGENT in kyc-refresh asset-recon transaction-anomaly-triage treasury-liquidity-briefing; do
  curl -sf -X POST http://localhost:8080/agents/$AGENT/deploy \
    -H "X-Atom-Actor: user:admin@atom.demo"
done
curl -sf -X POST http://localhost:8081/workflows/ats-asset-transfer/register \
  -H "Content-Type: application/json" -d '{}'
```

### Pre-warm script (fastest)

```bash
bash scripts/pre-warm.sh    # deploys + health-checks all agents
```

---

## 5. Validate demo paths

```bash
bash scripts/validate-paths.sh
```

All 3 paths should print `PASS`. Expected time: 30–90 s each.

---

## 6. Login and roles

The platform uses **role-button login** — no passwords. Three personas:

| Role | Identity | Permissions |
|---|---|---|
| **Builder** | `user:builder@atom.demo` | Build agents/workflows; submit deployment requests |
| **Approver** | `user:approver@atom.demo` | Review requests; approve/reject/request-changes; deploy own work directly |
| **Platform Admin** | `user:admin@atom.demo` | All permissions; bypass approval; access Settings |

**In the UI:** http://localhost:5173 shows a role-button login screen.

**In the CLI:**
```bash
atom login --as builder     # or approver / admin
atom whoami
atom logout
```

> **V1 security note:** Backends trust the `X-Atom-Actor` header unconditionally. Single-host demo only. Production replaces role-button login with your IDP. See `docs/identity-and-audit.md § V1 Security Boundary` before rehearsal Q&A.

---

## 7. Building and deploying an agent

### From the UI (Mode A — AI-generated)

1. Log in as **Builder** → **Agent Builder** in sidebar
2. Enter a prose description, click **Generate Spec**
3. Review the generated YAML and skill file in the Monaco editors
4. Click **Compile & Submit for Approval**
5. Log out → log in as **Approver** → go to **Approvals** tab
6. Find the pending request → click **Approve**
7. Deployment runs in background; check the agent's **Deployments** tab for status and approval thread

### From the CLI (Mode B — scaffold + manual)

```bash
atom login --as builder

# Create stub files
atom agent scaffold my-agent --domain banking-kyc

# Edit the generated files
open specs/agents/my-agent.yaml       # fill in tools, model, etc.
open agent-roles/banking-kyc/my-agent.role.md  # fill in skill instructions

# Validate
atom agent validate specs/agents/my-agent.yaml

# Submit for approval (as Builder)
atom agent deploy my-agent
# → "Submitted deployment request dep-XXXXXXXX for agent my-agent v0.1.0"

# Approve (as Approver)
atom login --as approver
atom deployments list --status pending
atom deployments approve dep-XXXXXXXX --note "approved"

# Verify deployment
atom agent history my-agent
atom agent list
```

### Approval flow CLI reference

```bash
atom deployments list                             # all requests
atom deployments list --status pending            # only pending
atom deployments list --requester me              # only my requests
atom deployments get dep-XXXXXXXX                 # full record + approval state
atom deployments approve dep-XXXXXXXX --note "ok"
atom deployments reject dep-XXXXXXXX --reason "spec incomplete"
atom deployments request-changes dep-XXXXXXXX --comments "add threshold docs"
```

---

## 8. Building and deploying a workflow

### From the UI (Composer)

1. Log in as **Builder** → **Workflow Composer**
2. Open an existing workflow (e.g. `ats-asset-transfer`) or create a new one
3. Add/edit nodes on the canvas; set properties in the Inspector panel
4. Click **Save** (saves spec + registers the workflow as Approver/Admin, or submits request as Builder)
5. As Approver: check the **Approvals** tab → approve → workflow is registered and runnable

### From the CLI

```bash
atom login --as builder

# Create stub
atom workflow init my-workflow

# Edit the spec
open specs/workflows/my-workflow.yaml

# Validate
atom workflow validate specs/workflows/my-workflow.yaml

# Submit for approval (Builder) or register directly (Approver/Admin)
atom workflow register my-workflow

# As Approver: approve and register
atom login --as approver
atom deployments list --status pending
atom deployments approve dep-XXXXXXXX

# View history
atom workflow history my-workflow
```

### Run a workflow

```bash
# Via CLI
atom workflow run ats-asset-transfer \
  --input '{"transfer_id":"XFER-100442-001","customer_id":"CUST-100442","amount_usd":40000,"securities":[{"cusip":"912828ZQ6","quantity":40}],"destination":{"custodian":"JPMorgan","account":"ACC-JPM-9934"}}'

# Via UI: Workflow Composer → Run pane → fill form → Start Run
# SSE events stream live; nodes highlight as they execute
```

---

## 9. Deployment versioning and approval (what the demo shows)

Every deploy goes through a governance gate:

```
Builder submits "Submit for Deployment"
  → dep-XXXXXXXX created (status: pending)

Approver opens Approvals tab
  → sees request, requester's note, spec hash
  → clicks Approve
  → container build starts in background (async, returns immediately)
  → dep-XXXXXXXX transitions: pending → deploying → deployed
  → both requester and approver identities recorded in audit trail

Platform Admin can "Deploy (bypass)"
  → labeled "bypassed" in audit — visible, not hidden
```

**Where to see it:**
- **Approvals** tab (sidebar, Approver/Admin only) — Pending + Resolved tabs with action dialogs and approval thread view
- **Agent/Workflow Registry** → click any name → **Deployments** tab — history for that target with expandable approval threads
- **CLI:** `atom deployments list` / `atom deployments get <id>`

---

## 10. Three build modes

| Mode | Agent build | Workflow build |
|---|---|---|
| **A. Visual + AI** | Builder UI generates spec from prose | Composer drag-and-drop + AI suggest |
| **B. CLI scaffold + manual** | `atom agent scaffold` → edit YAML → `atom agent deploy` | `atom workflow init` → edit YAML → `atom workflow register` |
| **C. Full natural-language** | Same as A | Composer generates entire workflow from prose (demo-optional) |

---

## 11. CLI reference summary

```bash
# Auth
atom login --as builder|approver|admin
atom whoami
atom logout

# Agents
atom agent scaffold <name> [--domain <d>]
atom agent list
atom agent validate specs/agents/<name>.yaml
atom agent deploy <name> [--note "..."]      # role-aware
atom agent history <name>

# Workflows
atom workflow init <name>
atom workflow validate specs/workflows/<name>.yaml
atom workflow register <name> [--note "..."] # role-aware
atom workflow history <name>
atom workflow run <name> --input '<json>'

# Deployment requests
atom deployments list [--status <s>] [--requester me] [--type agent|workflow]
atom deployments get <dep-id>
atom deployments approve <dep-id> [--note "..."]
atom deployments reject <dep-id> --reason "..."
atom deployments request-changes <dep-id> --comments "..."

# Env overrides
ATOM_BUILDER_URL=http://localhost:8080   # default
ATOM_WORKFLOW_URL=http://localhost:8081  # default
```

---

## 12. Key ports

| Service | Port | Purpose |
|---|---|---|
| ATOM Platform UI | 5173 | Main demo surface |
| builder-backend API | 8080 | Agent build, deploy, identity |
| workflow-backend API | 8081 | Workflow register, runs, audit |
| LiteLLM gateway | 4000 | All LLM + tool calls |
| MinIO API | 9000 | Audit log storage |
| MinIO console | 9001 | Browse audit logs |
| Temporal | 7233 | Workflow engine |
| Temporal UI | 8233 | Workflow run history |
| Studio | 3000 | Agent trace viewer |
| Grafana | 3001 | Logs + traces dashboard |

---

## 13. What this is not

A production system. It's a TechShift demo to land follow-up engagements with US bank prospects. All external calls hit mock services; no real bank systems touched.

---

## See also

- [`CLAUDE.md`](./CLAUDE.md) — context for AI coding assistants
- [`docs/architecture.md`](./docs/architecture.md) — system design
- [`docs/identity-and-audit.md`](./docs/identity-and-audit.md) — NHI model + V1 security boundary
- [`docs/workflow-spec-format.md`](./docs/workflow-spec-format.md) — workflow YAML schema
- [`docs/tasks/05b-user-management-and-deployment-versioning.md`](./docs/tasks/05b-user-management-and-deployment-versioning.md) — this session's task
