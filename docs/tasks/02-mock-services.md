# Task 02 — Mock Services

## Goal

All nine mock services are running, healthy, and serve seeded data that supports the demo paths. Specifically: KYC service returns three demo customer profiles (routine, high-value, stale-doc); SWIFT gateway accepts MT103-style instructions; OFAC returns clean for all demo customers; task queue accepts and resolves human tasks.

## Steps

1. **Verify mocks build and run.**
   ```bash
   docker compose build treasury-dw market-data lcr-engine fnol-svc ocr-svc \
     kyc-svc ofac-svc swift-gw task-queue
   docker compose up -d treasury-dw market-data lcr-engine fnol-svc ocr-svc \
     kyc-svc ofac-svc swift-gw task-queue
   docker compose ps
   ```
   All nine should be running with no restarts.

2. **Health checks.**
   ```bash
   for port in 8090 8091 8092 8093 8094 8095 8096 8097 8098; do
     echo "port $port:"; curl -s http://localhost:$port/health; echo
   done
   ```
   Every service responds `{"status": "ok"}`.

3. **Verify ATS demo data.**
   ```bash
   # Routine customer (clean profile)
   curl -s http://localhost:8095/profile/CUST-100442 | jq

   # High-value customer (clean, used for high-value path)
   curl -s http://localhost:8095/profile/CUST-200119 | jq

   # Stale-doc customer (KYC agent should return low confidence)
   curl -s http://localhost:8095/profile/CUST-300577 | jq
   # Confirm last_kyc_date is from 2023 (>730 days stale)

   # OFAC clean for all
   for cid in CUST-100442 CUST-200119 CUST-300577; do
     curl -s -X POST http://localhost:8096/screen \
       -H "Content-Type: application/json" \
       -d "{\"customer_id\": \"$cid\"}" | jq
   done
   ```

4. **Test the task queue end-to-end.**
   ```bash
   # Create a task
   TASK=$(curl -s -X POST http://localhost:8098/tasks \
     -H "Content-Type: application/json" \
     -d '{"workflow_run_id": "test-1", "node_id": "final-accept",
          "assignee_group": "ops", "title": "Test task",
          "description": "smoke test", "actions": ["accept", "reject"]}')
   TASK_ID=$(echo $TASK | jq -r .task_id)

   # Confirm it's open
   curl -s "http://localhost:8098/tasks?status=OPEN" | jq

   # Resolve it
   curl -s -X POST http://localhost:8098/tasks/$TASK_ID/resolve \
     -H "Content-Type: application/json" \
     -d '{"resolution": "accept", "resolved_by": "user:demo@atom.demo"}' | jq

   # Confirm resolved
   curl -s "http://localhost:8098/tasks/$TASK_ID" | jq '.status'  # "RESOLVED"
   ```

5. **Test SWIFT gateway.**
   ```bash
   curl -s -X POST http://localhost:8097/instructions \
     -H "Content-Type: application/json" \
     -d '{"transfer_id": "XFER-TEST-001", "amount_usd": 40000,
          "securities": [], "destination": {}}' | jq
   ```
   Should return `instruction_id`, `status: ACCEPTED`.

## Definition of Done

- [ ] All 9 mock services healthy
- [ ] KYC returns 3 demo profiles, with CUST-300577 showing `is_stale: true`
- [ ] OFAC clean for all 3 customers
- [ ] Task queue lifecycle (create → open → resolve) works
- [ ] SWIFT gateway accepts an instruction and returns an ID

## What this session does NOT do

- No agent code yet — these are just data sources
- No workflow registration — that's task 03b
- No frontend — task 04

## Sample data philosophy

Three customers, each tied to one demo path:

| Customer | Path | KYC profile | Why |
|---|---|---|---|
| CUST-100442 | Routine ($40K) | Clean, fresh | Agent passes confidence ≥ 0.85; routes through routine recon |
| CUST-200119 | High-value ($1.2M) | Clean, fresh | Agent passes; decision node routes to compliance review |
| CUST-300577 | Confidence breach | Stale docs (>730d), MEDIUM risk | Agent returns confidence ~0.72; routes to KYC human review |

If any of these stops returning the expected data shape during a rehearsal, fix the mock — don't change the agent's threshold.
