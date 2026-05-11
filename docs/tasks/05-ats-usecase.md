# Task 05 — ATS Workflow End-to-End

## Goal

Three demo paths through the ATS workflow run reliably end-to-end, on demand, in front of an audience. This is the demo's depth showcase.

## The three paths — must all work

### Path A: Routine transfer ($40K)

Input:
```json
{
  "transfer_id": "XFER-RT-001",
  "customer_id": "CUST-100442",
  "amount_usd": 40000,
  "securities": [{"cusip": "912828ZQ6", "qty": 1000}],
  "destination": {"institution": "Bank B", "account_ref": "..."}
}
```

Expected execution:
1. `receive-request` → 200 OK
2. `kyc-refresh` (agent) → confidence 0.94, recommendation PASS
3. (no human review)
4. `ofac-screen` → clean
5. `amount-decision` → false (≤ $250K) → routes to `asset-recon`
6. `asset-recon` (agent) → confidence 0.88, recommendation PASS
7. `swift-submit` → instruction ID returned
8. `final-accept` (human task) → PAUSE → demo runner clicks "Accept"
9. `notify` → done

Total time: ~4 min including the human accept (which is most of it). Total agent + http time: ~30–40 sec.

### Path B: High-value transfer ($1.2M)

Input: same shape, `customer_id: CUST-200119`, `amount_usd: 1200000`, larger `securities` list.

Expected execution:
1. receive-request → OK
2. kyc-refresh → confidence 0.91, PASS
3. ofac-screen → clean
4. **amount-decision → true → routes to `compliance-review` (NOT to asset-recon)**
5. **compliance-review (human task) → PAUSE → demo runner clicks "Accept"**
6. swift-submit → OK
7. final-accept (human task) → PAUSE → demo runner clicks "Accept"
8. notify → done

Demonstrates: "humans still on the cases that need judgment." Two distinct human gates.

### Path C: KYC confidence breach

Input: same shape, `customer_id: CUST-300577` (the stale-doc customer), routine amount.

Expected execution:
1. receive-request → OK
2. kyc-refresh (agent) → **confidence 0.72** (below 0.85 threshold)
3. **threshold routing kicks in → routes to `kyc-human-review` BEFORE OFAC**
4. kyc-human-review (human task) → PAUSE → demo runner clicks "Accept" with edit notes
5. ofac-screen → clean
6. amount-decision → false → asset-recon
7. asset-recon → PASS
8. swift-submit → OK
9. final-accept → PAUSE → Accept
10. notify → done

Demonstrates: "the agent knows when it doesn't know." The safety story.

## Steps to make all three reliable

1. **Tune the KYC agent's confidence calculation.** Test it standalone against all three customer profiles 10 times each. CUST-100442 should consistently return 0.85+; CUST-200119 0.85+; CUST-300577 below 0.85. If it's flaky:
   - Tighten the skill's confidence rubric (be more prescriptive)
   - Increase `reasoning_effort` to high
   - Reduce variance by making the JSON output schema stricter
2. **Tune the asset-recon agent similarly.** Use synthetic positions where the routine path's positions match cleanly and the high-value path takes the human-review fork via decision branch (recon agent isn't called on high-value).
3. **Pre-warm the agent containers** before the demo. Run a smoke invocation through each agent to load weights / warm caches.
4. **Verify the workflow registers cleanly** at startup. If validation fails, the demo is dead — set up a CI job locally that re-validates after every spec change.
5. **Test the SSE event stream** with the frontend Composer canvas. Each node should light up within 200ms of the backend emitting `node_started`.
6. **Test the human task UX**. The task should appear in the Tasks pane within 1 second of the workflow pausing.
7. **Test the audit pane**. After Path A completes, the audit pane should show:
   - 1 deploy event for each of the 2 agents (system actor)
   - ~6 LLM calls (agent actors, distinct service-account IDs)
   - ~3 http events (system actor for the engine)
   - 1 human resolution (human actor)
   At least three distinct actor types must appear. **This is the demo's killer slide.**

## Demo path validation script

```bash
#!/bin/bash
# scripts/validate-paths.sh — run this before any rehearsal

for path in routine high-value confidence-breach; do
  echo "Testing path: $path"
  ./scripts/run-path.sh $path
  if [ $? -ne 0 ]; then
    echo "FAIL on $path"
    exit 1
  fi
done
echo "All three paths green"
```

Run this 10 times the day of the demo. If any single failure: do not demo live. Fall back to recording.

## Definition of Done

- [ ] Path A runs successfully 10 consecutive times
- [ ] Path B runs successfully 10 consecutive times
- [ ] Path C runs successfully 10 consecutive times
- [ ] All three paths show correct actor types in audit
- [ ] All three paths complete within target wall-clock time
- [ ] SSE event stream is smooth (no >2 sec gaps between events)
- [ ] Pre-warm script reliably reduces first-call latency

## What can fail and how to recover

| Failure | Recovery |
|---|---|
| Agent confidence drifts on demo day | Manually pin the agent to a saved seed run via mocked LLM response; switch to "deterministic mode" which returns a stored output |
| Temporal worker dies mid-demo | Compose has `restart: unless-stopped`; will recover within 10 sec; be ready with "let me restart that node" filler |
| Mock service crashes | All mocks have `restart: unless-stopped`; if persistent, switch to pre-recorded fallback |
| Human task UI doesn't update | Refresh once; if still broken, resolve via curl from a terminal you have ready |

The general rule: **never debug live**. If something fails twice, switch to the pre-recorded fallback (task 07). The audience would rather see a recording than a platform person typing into a terminal.
