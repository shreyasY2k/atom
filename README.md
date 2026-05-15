# Atom Agent Platform

A production-grade platform for building, deploying, and governing AI agents in automated workflows.

**Two surfaces:**

- **Agent Builder** — generate agents from prose or YAML spec. Each agent gets a non-human service-account identity at deploy time.
- **Workflow Composer** — visual drag-and-drop workflow builder on Temporal. Replace routine human steps with agents. Retain humans at critical decision points.

**Stack:** AgentScope · Temporal · LiteLLM (Gemini gateway) · ReMe (memory) · React + Vite + MUI · MinIO (audit, object lock)

---

## Key Features

- **Agent Builder** — generate, compile, and deploy agents from prose descriptions or YAML specs via Gemini 3.1 Pro
- **Workflow Composer** — visual canvas for building workflows on Temporal; four node types: `agent`, `http`, `decision`, `human_task`
- **Identity management** — every agent gets a unique non-human service account (LiteLLM virtual key) at deploy time; audit logs record `actor_type` (`agent`|`human`|`system`) and `actor_id`
- **Audit trail** — every LLM call, tool call, workflow node execution, and human decision written to MinIO with 90-day object lock (COMPLIANCE mode)
- **Safety gate** — every state-changing HTTP call in a workflow must have an adjacent `human_task` node; enforced by the validator
- **Approval workflow** — Builder submits, Approver reviews, Platform Admin can bypass; all actions recorded
- **Three build modes** — Visual + AI (Mode A), CLI scaffold + manual (Mode B), full natural-language (Mode C)

---

## Prerequisites

- Docker + Docker Compose (Docker Desktop ≥ 4.x)
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/app/apikey)
- Python 3.9+ (for the CLI, optional)

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/shreyasY2k/atom.git
cd atom

# Copy env template and set your Gemini key
cp .env.example .env
# Edit .env: set GEMINI_API_KEY=your-key-here

# Build all images (~10–15 min first time; builds AgentScope, Studio, ReMe from source)
docker compose build

# Start the stack
docker compose up -d

# Verify all services are healthy
docker compose ps
```

---

## Surface URLs

| Surface | URL | Default creds |
|---|---|---|
| **Atom Platform UI** (Builder + Composer) | http://localhost:5173 | role-button login (no password) |
| AgentScope Studio (agent traces) | http://localhost:3000 | — |
| Temporal Web UI (workflow runs) | http://localhost:8233 | — |
| MinIO console (audit logs) | http://localhost:9001 | `minioadmin` / `minioadmin` |
| LiteLLM dashboard | http://localhost:4000/ui | master key from `.env` |
| Grafana (logs + traces) | http://localhost:3001 | `admin` / `admin` |

---

## Deploy Agents and Register Workflows

### Via CLI

```bash
# Install the CLI (one-time)
pip3 install -e cli/

# Log in as Platform Admin
atom login --as admin

# Deploy agents
atom agent deploy <agent-name>

# Register a workflow
atom workflow register <workflow-name>

# Verify
atom agent list
```

### Via UI

1. Open http://localhost:5173 → log in as **Platform Admin**
2. Go to **Agents → Registry** → click **Deploy (bypass)** on each agent card
3. Go to **Workflows → Registry** → click **Re-register** on the workflow

### Via curl

```bash
curl -sf -X POST http://localhost:8080/agents/<agent-name>/deploy \
  -H "X-Atom-Actor: user:admin@atom.io"

curl -sf -X POST http://localhost:8082/workflows/<workflow-name>/register \
  -H "Content-Type: application/json" -d '{}'
```

---

## Login and Roles

The platform uses **role-button login** — no passwords. Three personas:

| Role | Identity | Permissions |
|---|---|---|
| **Builder** | `user:builder@atom.io` | Build agents/workflows; submit deployment requests |
| **Approver** | `user:approver@atom.io` | Review requests; approve/reject/request-changes; deploy own work directly |
| **Platform Admin** | `user:admin@atom.io` | All permissions; bypass approval; access Settings |

---

## Building an Agent

### From the UI (Mode A — AI-generated)

1. Log in as **Builder** → **Agent Builder** in sidebar
2. Enter a prose description, click **Generate Spec**
3. Review the generated YAML and skill file in the Monaco editors
4. Click **Compile & Submit for Approval**
5. Log out → log in as **Approver** → go to **Approvals** tab
6. Find the pending request → click **Approve**

### From the CLI (Mode B — scaffold + manual)

```bash
atom login --as builder

# Create stub files
atom agent scaffold my-agent --domain my-domain

# Edit the generated files
open specs/agents/my-agent.yaml
open agent-roles/my-domain/my-agent.role.md

# Validate
atom agent validate specs/agents/my-agent.yaml

# Submit for approval
atom agent deploy my-agent

# As Approver: approve
atom login --as approver
atom deployments list --status pending
atom deployments approve dep-XXXXXXXX --note "approved"
```

---

## Building a Workflow

### From the UI (Composer)

1. Log in as **Builder** → **Workflow Composer**
2. Open an existing workflow or create a new one
3. Add/edit nodes on the canvas; set properties in the Inspector panel
4. Click **Save**

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

# Run a workflow
atom workflow run my-workflow --input '{"key": "value"}'
```

---

## CLI Reference

```bash
# Auth
atom login --as builder|approver|admin
atom whoami
atom logout

# Agents
atom agent scaffold <name> [--domain <d>]
atom agent list
atom agent validate specs/agents/<name>.yaml
atom agent deploy <name> [--note "..."]
atom agent history <name>

# Workflows
atom workflow init <name>
atom workflow validate specs/workflows/<name>.yaml
atom workflow register <name> [--note "..."]
atom workflow history <name>
atom workflow run <name> --input '<json>'

# Deployment requests
atom deployments list [--status <s>] [--requester me] [--type agent|workflow]
atom deployments get <dep-id>
atom deployments approve <dep-id> [--note "..."]
atom deployments reject <dep-id> --reason "..."
atom deployments request-changes <dep-id> --comments "..."
```

---

## Running End-to-End Tests

```bash
pip install -r tests/requirements.txt

# With services running:
BUILDER_URL=http://localhost:8080 WORKFLOW_URL=http://localhost:8082 \
  pytest tests/e2e/ -v
```

---

## Key Ports

| Service | Port | Purpose |
|---|---|---|
| Atom Platform UI | 5173 | Main UI surface |
| builder-backend API | 8080 | Agent build, deploy, identity |
| workflow-backend API | 8082 | Workflow register, runs, audit |
| LiteLLM gateway | 4000 | All LLM + tool calls |
| MinIO API | 9000 | Audit log storage |
| MinIO console | 9001 | Browse audit logs |
| Temporal | 7233 | Workflow engine |
| Temporal UI | 8233 | Workflow run history |
| Studio | 3000 | Agent trace viewer |
| Grafana | 3001 | Logs + traces dashboard |

---

## Architecture

- **LLM gateway**: All LLM and tool calls go through LiteLLM at `http://litellm:4000`. Gemini-only (`gemini-3.1-pro`, `gemini-3-flash`, `gemini-embedding-2`).
- **Workflow engine**: Temporal (official image). The platform wraps Temporal — it does not build a workflow engine.
- **Agent runtime**: AgentScope + AgentScope Runtime (built from source).
- **Memory**: ReMe (built from source), backed by PostgreSQL + ChromaDB.
- **Audit**: MinIO with object lock in COMPLIANCE mode, 90-day retention.
- **Observability**: AgentScope Studio + OTEL collector + Prometheus + Loki + Tempo + Grafana.

See [`docs/architecture.md`](./docs/architecture.md) for the full system design.

---

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) — system design, data flow, deployment, identity model
- [`docs/identity-and-audit.md`](./docs/identity-and-audit.md) — NHI model, audit posture, V1 security boundary
- [`docs/workflow-spec-format.md`](./docs/workflow-spec-format.md) — workflow YAML schema reference
