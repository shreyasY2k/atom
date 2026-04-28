# SESSION-09 — atom-studio HITL + Deployment Approval

**Prerequisites:** SESSION-08 complete  
**Goal:** Build the HITL decision dashboard and the deployment approval workflow.  
**Estimated time:** 1.5 days

---

## Tasks

1. **HITL API** (`atom-studio/src/atom_hitl/`)
   - `GET  /api/hitl/queue`                  — list pending decisions (filtered by role)
   - `GET  /api/hitl/{id}`                   — get decision detail
   - `POST /api/hitl/{id}/decide`            — submit approve/reject with note
   - `GET  /api/hitl/history`                — resolved decisions (paginated)
   - `POST /api/hitl/request`                — called by agents via GATE to create HITL record

2. **Deployment approval API** (reuses `hitl_workflows` table with `workflow_type = 'DEPLOYMENT_APPROVAL'`)
   - `POST /api/deployments/{agent_id}`      — submit deployment request → creates HITL record
   - `GET  /api/deployments/{agent_id}`      — list deployment history
   - Approval triggers `atom-runtime` to execute the k8s rollout (SESSION-11 webhook).

3. **WebSocket notifications** (`/ws/hitl`)
   - Push new pending decisions to connected studio clients in real-time.
   - Studio frontend shows a badge counter on the HITL menu item.

4. **HITL queue page** (frontend)
   - Table with: Agent name, Decision type, Payload preview, Submitted time, Timeout countdown.
   - Click row → decision detail drawer with full payload JSON.
   - Approve/Reject buttons with optional note field.
   - Filter by: ALL | BUSINESS_DECISION | DEPLOYMENT_APPROVAL | MY_QUEUE.

5. **Decision detail view** — shows:
   - Full payload (prettified JSON).
   - Agent context: name, domain, tools.
   - `hitl_fallback` setting (what happens if this times out).
   - Timeout countdown timer.

6. **Deployment history page** (frontend)
   - Per-agent deployment history with status badges.
   - "Approve deployment" button for platform admins.

7. **Audit**: every HITL decision recorded to `audit_log_chain` and `atom.audit` Kafka topic.

---

## Technologies

| Technology | Rationale |
|---|---|
| WebSocket (FastAPI) | Real-time push for new HITL decisions without polling |
| `hitl_workflows` table | Shared table for both business HITL and deployment approvals |
| Timeout background task | FastAPI background task to expire old HITL records |

---

## Acceptance Criteria

- [ ] `POST /api/hitl/request` from an agent JWT → creates pending record.
- [ ] Decision appears in HITL queue page within 2s (WebSocket push).
- [ ] `POST /api/hitl/{id}/decide` with `approved: true` → record resolved.
- [ ] atom-sdk `request_human_decision()` returns `{approved: true}` after studio approval.
- [ ] `POST /api/deployments/{agent_id}` creates HITL record of type `DEPLOYMENT_APPROVAL`.
- [ ] Expired HITL records (past `expires_at`) automatically move to `timed_out` status.
- [ ] Every decision recorded in `audit_log_chain`.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-09 of ATOM — HITL dashboard and deployment approval in atom-studio.

Context: atom-studio has auth + agent management. hitl_workflows and deployments tables exist.

Tasks:
1. Create atom_hitl/ backend module with CRUD for hitl_workflows
2. Implement POST /api/hitl/request — called by agents; creates hitl_workflows record
3. Implement POST /api/hitl/{id}/decide — approve or reject; log to audit chain
4. Add WebSocket endpoint /ws/hitl — broadcasts new decisions to subscribers
5. Add deployment approval flow: POST /api/deployments/{agent_id} creates HITL workflow
   of type DEPLOYMENT_APPROVAL; on approval, call atom-runtime webhook (stub for SESSION-11)
6. Background task: scan for expired HITL records (past expires_at) and set status=timed_out
7. Frontend: HITL queue page with real-time WebSocket updates and badge counter in nav
8. Frontend: Decision detail drawer with approve/reject + note
9. Frontend: Deployment history page with per-agent status

Every HITL decision must be recorded to audit_log_chain via the same chain logic as GATE.
```

---

