# ATOM Agent Platform — TechShift Demo

A two-surface platform for BFSI process automation:

- **Agent Builder** — builds audited, deployable AI agents from a versioned spec.
- **Workflow Composer** — loads existing BFSI workflows; replaces routine human-decision steps with agents; keeps humans on the calls that matter.

Stack: **Gemini-only**, **AgentScope + Temporal**, **single LiteLLM gateway**, **MinIO with object lock for audit**.

Flagship demo use case: **Asset Transfer Service (ATS)** for US bank securities operations.

---

## Quick start

```bash
cp .env.example .env
# Set GEMINI_API_KEY in .env

docker compose build      # ~10–15 min first time (AgentScope, Studio, ReMe from source)
docker compose up -d
docker compose ps         # confirm all services Up/healthy
```

> **After a rebuild from a previous run:** `docker compose down --remove-orphans` before `up` to clear containers from the old project name.

### Surface URLs

| Surface | URL | Notes |
|---|---|---|
| **ATOM Platform UI** | http://localhost:5173 | Builder + Composer (Vite dev server) |
| AgentScope Studio | http://localhost:3000 | Agent traces |
| Temporal Web UI | http://localhost:8233 | Workflow run history |
| MinIO console | http://localhost:9001 | Audit logs (minioadmin / minioadmin) |
| LiteLLM dashboard | http://localhost:4000/ui | LLM calls + virtual keys |
| Grafana | http://localhost:3001 | Logs (Loki) + traces (Tempo) |

---

## Login (new in 05b)

The platform uses **role-button login** — no passwords, no JWTs. Click a role to become that persona for the demo:

| Role | Identity | Can do |
|---|---|---|
| **Builder** | `user:builder@atom.demo` | Build agents/workflows; submit deployment requests |
| **Approver** | `user:approver@atom.demo` | Approve/reject deployment requests; deploy directly |
| **Platform Admin** | `user:admin@atom.demo` | All of the above; bypass approval; see Settings |

> **V1 security note:** Backends trust the `X-Atom-Actor` header unconditionally. This is intentional for a single-host demo. Production adds gateway-level IDP enforcement. See `docs/identity-and-audit.md § V1 Security Boundary` before rehearsal Q&A.

---

## Deployment approval workflow (new in 05b)

Every agent and workflow deployment goes through an approval gate:

```
Builder clicks "Submit for Deployment"
  → deployment request (dep-<id>) created, status: pending
  → Approver sees it in the Approvals tab

Approver reviews, clicks Approve
  → container build triggered in background (async)
  → deployment record transitions: pending → deploying → deployed
  → both requester and approver identities recorded in audit
```

Platform Admin can bypass approval ("Deploy (bypass)") — visibly labeled in the audit trail.

---

## CLI

```bash
cd cli && pip install -e .
```

### Auth
```bash
atom login --as builder      # sets ~/.atom/session.json
atom login --as approver
atom login --as admin
atom whoami
atom logout
```

### Agent commands
```bash
atom agent scaffold <name> --domain <domain>   # stub spec + role file
atom agent list                                # registry (name, version, service account)
atom agent validate specs/agents/<name>.yaml  # calls backend validate
atom agent deploy <name>                       # role-aware:
                                               #   builder  → submit for approval
                                               #   approver → direct deploy
                                               #   admin    → bypass deploy
atom agent history <name>                      # deployment history
```

### Workflow commands
```bash
atom workflow init <name>
atom workflow validate specs/workflows/<name>.yaml
atom workflow register <name>                  # role-aware (same as agent deploy)
atom workflow history <name>
atom workflow run <name> --input '<json>'
```

### Deployment request commands
```bash
atom deployments list                          # all requests
atom deployments list --status pending
atom deployments list --requester me
atom deployments get dep-<id>
atom deployments approve dep-<id> --note "looks good"
atom deployments reject dep-<id> --reason "spec incomplete"
atom deployments request-changes dep-<id> --comments "add threshold docs"
```

Override API URLs: `ATOM_BUILDER_URL` (default `http://localhost:8080`), `ATOM_WORKFLOW_URL` (default `http://localhost:8081`).

---

## Deployed agents

The 4 ATS agents must be deployed before running demo paths. After a fresh `docker compose up`, deploy them:

```bash
# As admin (direct, no approval gate)
atom login --as admin
for AGENT in kyc-refresh asset-recon transaction-anomaly-triage treasury-liquidity-briefing; do
  atom agent deploy $AGENT
done

# Then register the ATS workflow
atom workflow register ats-asset-transfer
```

Or use the pre-warm script (deploys + health-checks):
```bash
bash scripts/pre-warm.sh
```

| Agent | Domain | Container |
|---|---|---|
| `kyc-refresh` | banking-KYC | `agent-kyc-refresh-1-0-0` |
| `asset-recon` | securities-ops | `agent-asset-recon-1-0-0` |
| `transaction-anomaly-triage` | banking-fraud | `agent-transaction-anomaly-triage-1-0-0` |
| `treasury-liquidity-briefing` | treasury | `agent-treasury-liquidity-briefing-1-0-0` |

---

## Three build modes

| Mode | Description |
|---|---|
| **A. Visual + AI** | UI generates from prose. Fastest. Demo path 1. |
| **B. CLI scaffold + manual** | `atom agent scaffold` + `atom workflow init` produce stubs; developer fills in. Demo path 2. |
| **C. Full natural-language** | UI generates entire workflow from prose. Demo-optional; disable cleanly if it misbehaves. |

---

## Validate demo paths

```bash
bash scripts/validate-paths.sh   # runs all 3 ATS paths; exits non-zero if any fail
```

Expected output: all three paths `PASS` in 30–90 s each.

---

## What this is not

A production-grade product. It's a TechShift capability demo to land follow-up engagements with US bank prospects.

---

## See also

- [`CLAUDE.md`](./CLAUDE.md) — context for AI coding assistants
- [`docs/architecture.md`](./docs/architecture.md) — system design
- [`docs/identity-and-audit.md`](./docs/identity-and-audit.md) — non-human identity model + V1 security boundary
- [`docs/workflow-spec-format.md`](./docs/workflow-spec-format.md) — workflow YAML schema
- [`docs/tasks/00-overview.md`](./docs/tasks/00-overview.md) — work plan
- [`docs/tasks/05b-user-management-and-deployment-versioning.md`](./docs/tasks/05b-user-management-and-deployment-versioning.md) — this session's task
