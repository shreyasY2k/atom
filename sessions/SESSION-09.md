# SESSION-09 — atom-studio: HITL + Deployment Approval

**Prerequisites:** SESSION-08 complete
**Goal:** Build the HITL decision queue with real-time WebSocket push and the deployment approval workflow.
**Estimated time:** 1.5 days

---

## Context

HITL and deployment approval share one mechanism: the `hitl_workflows` table.
The only difference is `workflow_type`:
- `BUSINESS_DECISION` — triggered by agent code via `request_human_decision()`
- `DEPLOYMENT_APPROVAL` — triggered by `atom deploy` via the CLI

Both flow through the same queue UI. The deployment approval additionally triggers
atom-runtime to execute the k8s rollout on approval.

---

## Part 1 — HITL Backend

### 1. WebSocket manager (`src/atom_studio/ws/manager.py`)

```python
from fastapi import WebSocket
from collections import defaultdict

class ConnectionManager:
    def __init__(self):
        # keyed by user_id — each user can have multiple open browser tabs
        self._connections: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self._connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: str):
        self._connections[user_id].remove(websocket)

    async def broadcast(self, event: dict):
        """Send to all connected users (admins and developers see the queue)."""
        dead = []
        for user_id, sockets in self._connections.items():
            for ws in sockets:
                try:
                    await ws.send_json(event)
                except Exception:
                    dead.append((user_id, ws))
        for uid, ws in dead:
            self._connections[uid].remove(ws)

manager = ConnectionManager()
```

### 2. HITL module (`src/atom_studio/hitl/`)

**`router.py`** — endpoints:

```
GET  /api/hitl/queue              pending decisions (filtered: admin sees all, dev sees own agents)
GET  /api/hitl/{id}               decision detail + full payload
POST /api/hitl/{id}/decide        { approved: bool, note: str }
GET  /api/hitl/history            resolved decisions, paginated

# Called by agents via GATE → atom-studio
POST /api/hitl/request            { agent_id, workflow_type, payload, timeout_s }

# WebSocket — browser subscribes for live push
WS   /ws/hitl                     streams { type: NEW_DECISION | DECISION_MADE, ... }
```

**`service.py`**:

```python
async def create_hitl_request(agent_id, workflow_type, payload, timeout_s, conn):
    expires_at = datetime.utcnow() + timedelta(seconds=timeout_s)
    row = await conn.fetchrow("""
        INSERT INTO hitl_workflows
          (agent_id, workflow_type, payload, status, expires_at)
        VALUES ($1, $2, $3, 'pending', $4) RETURNING *
    """, agent_id, workflow_type, json.dumps(payload), expires_at)

    # Push to all connected studio browsers
    agent_name = await conn.fetchval(
        "SELECT name FROM agents WHERE id=$1", agent_id
    )
    await manager.broadcast({
        "type": "NEW_DECISION",
        "hitl_id": str(row["id"]),
        "workflow_type": workflow_type,
        "agent_name": agent_name,
        "payload": payload,
        "expires_at": expires_at.isoformat(),
    })
    return row

async def decide(hitl_id, approved, note, decided_by_user_id, conn):
    status = "approved" if approved else "rejected"
    await conn.execute("""
        UPDATE hitl_workflows
        SET status=$1, decision_note=$2, decided_by=$3, decided_at=now()
        WHERE id=$4
    """, status, note, decided_by_user_id, hitl_id)

    await manager.broadcast({
        "type": "DECISION_MADE",
        "hitl_id": str(hitl_id),
        "approved": approved,
        "note": note,
    })

    # If this is a deployment approval, trigger atom-runtime
    row = await conn.fetchrow(
        "SELECT workflow_type, payload FROM hitl_workflows WHERE id=$1", hitl_id
    )
    if row["workflow_type"] == "DEPLOYMENT_APPROVAL" and approved:
        await trigger_deployment(json.loads(row["payload"]), conn)
```

### 3. Background task — expire stale HITL records

```python
# Runs every 60s via asyncio background task started in main.py lifespan
async def expire_stale_hitl():
    while True:
        await asyncio.sleep(60)
        async with db() as conn:
            rows = await conn.fetch("""
                UPDATE hitl_workflows
                SET status='timed_out'
                WHERE status='pending' AND expires_at < now()
                RETURNING id, agent_id
            """)
            for row in rows:
                # Look up agent hitl_fallback and handle it
                agent = await conn.fetchrow(
                    "SELECT hitl_fallback FROM agents WHERE id=$1", row["agent_id"]
                )
                await manager.broadcast({
                    "type": "DECISION_TIMED_OUT",
                    "hitl_id": str(row["id"]),
                    "fallback": agent["hitl_fallback"],
                })
```

---

## Part 2 — Deployment Approval

### 4. Deployments module (`src/atom_studio/deployments/`)

**`router.py`**:

```
POST /api/deployments/{agent_id}      submit deployment request (from atom-cli)
GET  /api/deployments/{agent_id}      list deployment history for agent
GET  /api/deployments/{agent_id}/{deployment_id}  deployment detail

# Called by atom-runtime (webhook receiver)
POST /api/runtime/deploy-result       { deployment_id, status, error? }
POST /api/runtime/register            atom-runtime registers its webhook URL on startup
```

**`service.py`** — submit deployment:

```python
async def submit_deployment(agent_id, image, git_sha, message, submitted_by, conn) -> dict:
    # 1. Insert deployment record (status=pending)
    deployment = await conn.fetchrow("""
        INSERT INTO deployments (agent_id, image, git_sha, message, status, submitted_by)
        VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING *
    """, agent_id, image, git_sha, message, submitted_by)

    # 2. Update agent status
    await conn.execute(
        "UPDATE agents SET status='pending_approval' WHERE id=$1", agent_id
    )

    # 3. Create HITL workflow of type DEPLOYMENT_APPROVAL
    await create_hitl_request(
        agent_id=agent_id,
        workflow_type="DEPLOYMENT_APPROVAL",
        payload={
            "deployment_id": str(deployment["id"]),
            "image": image,
            "git_sha": git_sha,
            "message": message,
        },
        timeout_s=86400,   # 24h for deployment approvals
        conn=conn,
    )
    return deployment
```

**`service.py`** — trigger deployment (called after HITL approval):

```python
async def trigger_deployment(hitl_payload, conn):
    """Webhook to atom-runtime to start k8s rollout."""
    deployment_id = hitl_payload["deployment_id"]

    # Get full agent config for atom-runtime
    agent = await conn.fetchrow("""
        SELECT a.*, d.deployment_id
        FROM agents a
        JOIN deployments d ON d.id=$1
        WHERE a.id = d.agent_id
    """, deployment_id)

    runtime_url = get_settings().atom_runtime_url
    async with httpx.AsyncClient() as client:
        await client.post(f"{runtime_url}/runtime/deploy", json={
            "deployment_id": deployment_id,
            "agent_id": str(agent["id"]),
            "domain_id": str(agent["domain_id"]),
            "image": hitl_payload["image"],
            "memory_config_id": str(agent["memory_config_id"]) if agent["memory_config_id"] else None,
        })

    await conn.execute(
        "UPDATE deployments SET status='deploying' WHERE id=$1", deployment_id
    )
```

---

## Part 3 — Frontend

### 5. HITL queue page (`src/pages/HitlQueue.tsx`)

```
┌─────────────────────────────────────────────────────────┐
│  HITL Queue  [3 pending]                     [Filter ▼] │
├────────────┬──────────────┬──────────────┬──────────────┤
│ Agent      │ Type         │ Submitted    │ Expires in   │
├────────────┼──────────────┼──────────────┼──────────────┤
│ loan-agent │ BUSINESS     │ 2 mins ago   │ 4:53 ↓       │ ← countdown timer
│ risk-agent │ DEPLOYMENT   │ 10 mins ago  │ 23:49:12 ↓   │
└────────────┴──────────────┴──────────────┴──────────────┘
```

- Real-time updates via WebSocket (`/ws/hitl`) — new rows appear without refresh
- Nav badge counter shows pending count, updates live
- Filter by: ALL | BUSINESS | DEPLOYMENT | MY AGENTS

### 6. Decision drawer (`src/components/app/HitlDecisionDrawer.tsx`)

Slides in from the right when a row is clicked:

```
┌──────────────────────────────────────────────────────┐
│  loan-agent — Business Decision          [×] Close  │
│  ─────────────────────────────────────────────────  │
│  Payload:                                            │
│  {                                                   │
│    "action": "approve_loan",                         │
│    "amount": 50000,                                  │
│    "customer_id": "4821"                             │
│  }                                                   │
│                                                      │
│  Agent config: hitl_fallback = ABORT                 │
│  Expires: 4m 32s                                     │
│                                                      │
│  Decision note (optional):                           │
│  [ Verified by risk team per policy P-2024-07 ]      │
│                                                      │
│  [  Reject  ]           [  Approve  →  ]             │
└──────────────────────────────────────────────────────┘
```

### 7. Deployment history on agent detail page

Wire the stub table from SESSION-08's agent detail page:

```
Deployment History
─────────────────────────────────────────────────────────────
#  Image                          Status     Deployed at
─────────────────────────────────────────────────────────────
3  registry/loan-agent:abc123     deployed   2025-01-15 14:32
2  registry/loan-agent:def456     rolled_back  2025-01-14 09:10
1  registry/loan-agent:789ghi     failed     2025-01-13 16:04
```

---

## Acceptance Criteria

- [ ] `POST /api/hitl/request` → creates hitl_workflows record + broadcasts via WebSocket
- [ ] Connected browser receives `NEW_DECISION` event within 1s (no page refresh)
- [ ] Nav badge counter increments without refresh
- [ ] `POST /api/hitl/{id}/decide { approved: true }` → updates DB + broadcasts `DECISION_MADE`
- [ ] atom-sdk `request_human_decision()` resolves immediately after studio approval (next poll)
- [ ] `POST /api/deployments/{agent_id}` → creates deployment + HITL record of type `DEPLOYMENT_APPROVAL`
- [ ] Approving a `DEPLOYMENT_APPROVAL` HITL → calls atom-runtime `/runtime/deploy` webhook (stub ok for now — wired in SESSION-11)
- [ ] Background expiry task sets `status='timed_out'` for expired records
- [ ] Frontend HITL queue updates live via WebSocket
- [ ] Decision drawer shows full payload JSON + countdown timer
- [ ] Deployment history shows on agent detail page
- [ ] `pytest src/tests/test_hitl.py src/tests/test_deployments.py` passes

---

## Claude Code Starter Prompt

```
You are implementing SESSION-09 of ATOM — HITL queue and deployment approval in atom-studio.

Context:
- atom-studio backend (SESSION-07, 08) is running
- hitl_workflows and deployments tables exist in Postgres
- HITL and deployment approval share the hitl_workflows table (workflow_type differentiates)

Backend tasks:
1. Implement atom_studio/ws/manager.py — ConnectionManager for WebSocket broadcast
2. Implement atom_studio/hitl/router.py with all endpoints including WS /ws/hitl
3. Implement atom_studio/hitl/service.py — create_hitl_request (inserts + broadcasts),
   decide (updates + broadcasts + triggers deployment if DEPLOYMENT_APPROVAL)
4. Add asyncio background task (started in main.py lifespan) to expire stale HITL records
   every 60s — sets status='timed_out', broadcasts DECISION_TIMED_OUT
5. Implement atom_studio/deployments/router.py — submit_deployment, deployment history,
   POST /api/runtime/deploy-result (called back by atom-runtime), POST /api/runtime/register
6. Implement atom_studio/deployments/service.py — submit_deployment creates deployment
   record + DEPLOYMENT_APPROVAL HITL; trigger_deployment calls atom-runtime webhook
7. Add hitl_router and deployments_router to main.py

Frontend tasks:
1. HITL queue page with table, real-time WebSocket updates, nav badge counter
2. Decision drawer with JSON payload viewer, countdown timer, approve/reject + note
3. Wire deployment history table on agent detail page (from SESSION-08 stub)
4. Add /ws/hitl WebSocket hook in src/hooks/useHitlWebSocket.ts

Test: create an agent, run a request through it that calls request_human_decision(),
verify it appears in the studio HITL queue, approve it, verify agent unblocks.
```
