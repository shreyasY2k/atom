#!/usr/bin/env bash
# run-path.sh <routine|high-value|confidence-breach>
# Runs one ATS demo path end-to-end and automatically resolves human tasks.
# Prints PASS/FAIL and timing.

set -euo pipefail

PATH_NAME="${1:-routine}"
WF="http://localhost:8081"
TQ="http://localhost:8098"
TIMEOUT=300  # seconds before giving up

case "$PATH_NAME" in
  routine)
    PAYLOAD='{"transfer_id":"XFER-100442-001","customer_id":"CUST-100442","amount_usd":40000,"securities":[{"cusip":"912828ZQ6","quantity":40}],"destination":{"custodian":"JPMorgan","account":"ACC-JPM-9934"}}'
    EXPECTED_NODES="kyc-refresh,ofac-screen,amount-decision,asset-recon,swift-submit,final-accept,notify"
    ;;
  high-value)
    PAYLOAD='{"transfer_id":"XFER-200119-001","customer_id":"CUST-200119","amount_usd":1200000,"securities":[{"cusip":"912810RW0","quantity":1240}],"destination":{"custodian":"Goldman","account":"ACC-GS-4421"}}'
    EXPECTED_NODES="kyc-refresh,ofac-screen,amount-decision,compliance-review,swift-submit,final-accept,notify"
    ;;
  confidence-breach)
    PAYLOAD='{"transfer_id":"XFER-300577-001","customer_id":"CUST-300577","amount_usd":49000,"securities":[{"cusip":"912828ZQ6","quantity":50}],"destination":{"custodian":"Citibank","account":"ACC-CITI-7711"}}'
    EXPECTED_NODES="kyc-refresh,kyc-human-review,ofac-screen,amount-decision,asset-recon,swift-submit,final-accept,notify"
    ;;
  *)
    echo "Usage: $0 <routine|high-value|confidence-breach>"
    exit 1
    ;;
esac

echo "--- Path: $PATH_NAME ---"
START_TIME=$(date +%s)

# Start the workflow run
RUN=$(curl -sf -X POST "$WF/workflows/ats-asset-transfer/runs" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>/dev/null)
RUN_ID=$(echo "$RUN" | python3 -c "import sys,json; print(json.load(sys.stdin)['run_id'])")
echo "  run_id: $RUN_ID"

# Poll for human tasks and auto-resolve them
ELAPSED=0
COMPLETED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
  sleep 3
  ELAPSED=$((ELAPSED + 3))

  # Check if workflow completed in Temporal
  TEMPORAL_STATUS=$(curl -sf "http://localhost:8233/api/v1/namespaces/default/workflows/$RUN_ID" 2>/dev/null | \
    python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('workflowExecutionInfo',{}).get('status','?'))" 2>/dev/null || echo "UNKNOWN")

  if [ "$TEMPORAL_STATUS" = "WORKFLOW_EXECUTION_STATUS_COMPLETED" ]; then
    COMPLETED=1
    break
  fi

  # Resolve any open human tasks for this run
  TASKS=$(curl -sf "$TQ/tasks" 2>/dev/null | python3 -c "
import sys, json
tasks = json.load(sys.stdin)['tasks']
run_tasks = [t for t in tasks if t['workflow_run_id'] == '$RUN_ID']
for t in run_tasks:
    print(t['task_id'])
" 2>/dev/null || echo "")

  for TASK_ID in $TASKS; do
    echo "  Resolving human task $TASK_ID..."
    curl -sf -X POST "$TQ/tasks/$TASK_ID/resolve" \
      -H "Content-Type: application/json" \
      -d '{"resolution":"accept","resolved_by":"user:demo@atom.demo"}' > /dev/null
  done
done

END_TIME=$(date +%s)
WALL_TIME=$((END_TIME - START_TIME))

if [ $COMPLETED -eq 1 ]; then
  echo "  PASS — completed in ${WALL_TIME}s"
  exit 0
else
  echo "  FAIL — timed out after ${WALL_TIME}s (run_id=$RUN_ID)"
  exit 1
fi
