#!/usr/bin/env bash
# pre-warm.sh — invoke each ATS agent once to warm caches + verify they're healthy.
# Run this 2–3 minutes before the demo. Expected duration: ~30 seconds.

set -euo pipefail

API="http://localhost:8080"
WF="http://localhost:8081"

echo "=== ATOM Platform pre-warm ==="

# 0. Wait for agents to be ready (important if run immediately after redeploy)
echo "Waiting for agent containers to be ready..."
for agent in kyc-refresh asset-recon; do
  tries=0
  until curl -sf "$API/agents/$agent" 2>/dev/null | python3 -c "import sys,json; sys.exit(0 if json.load(sys.stdin).get('status')=='deployed' else 1)" 2>/dev/null; do
    tries=$((tries+1))
    if [ $tries -gt 20 ]; then echo "  FAIL: $agent not ready after 40s"; exit 1; fi
    sleep 2
  done
  echo "  $agent ready"
done

# 1. Verify infrastructure health
echo "Checking builder-backend..."
curl -sf "$API/health" > /dev/null && echo "  builder-backend OK" || { echo "  FAIL: builder-backend not healthy"; exit 1; }
echo "Checking workflow-backend..."
curl -sf "$WF/health" > /dev/null && echo "  workflow-backend OK" || { echo "  FAIL: workflow-backend not healthy"; exit 1; }

# 2. Warm KYC agent (uses a unique warm-up customer ID to avoid polluting demo memory)
echo "Warming kyc-refresh agent..."
KYC_RESULT=$(curl -sf -X POST "$API/agents/kyc-refresh/invoke" \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "CUST-100442", "_run_id": "warm-kyc"}' 2>/dev/null || echo '{"error":"timeout"}')
KYC_CONF=$(echo "$KYC_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('confidence','ERR'))" 2>/dev/null || echo "ERR")
echo "  kyc-refresh: confidence=$KYC_CONF"
if [ "$KYC_CONF" = "ERR" ]; then echo "  WARN: kyc-refresh returned unexpected output"; fi

# 3. Warm asset-recon agent
echo "Warming asset-recon agent..."
RECON_RESULT=$(curl -sf -X POST "$API/agents/asset-recon/invoke" \
  -H "Content-Type: application/json" \
  -d '{"transfer_id": "XFER-100442-001", "securities": [{"cusip": "912828ZQ6", "quantity": 40}], "_run_id": "warm-recon"}' 2>/dev/null || echo '{"error":"timeout"}')
RECON_CONF=$(echo "$RECON_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('result',{}).get('confidence','ERR'))" 2>/dev/null || echo "ERR")
echo "  asset-recon: confidence=$RECON_CONF"

# 4. Verify ATS workflow is registered
echo "Checking workflow registration..."
WF_STATUS=$(curl -sf "$WF/workflows/ats-asset-transfer" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','?'))" 2>/dev/null || echo "missing")
echo "  ats-asset-transfer: $WF_STATUS"
if [ "$WF_STATUS" != "registered" ]; then
  echo "  Re-registering workflow..."
  curl -sf -X POST "$WF/workflows/ats-asset-transfer/register" -H "Content-Type: application/json" -d '{}' > /dev/null
  echo "  Registered."
fi

# 5. Clear any stale open tasks from previous runs
echo "Clearing stale open tasks..."
OPEN_TASKS=$(curl -sf "http://localhost:8098/tasks" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['count'])" 2>/dev/null || echo "0")
if [ "$OPEN_TASKS" -gt 0 ]; then
  echo "  WARNING: $OPEN_TASKS open task(s) in queue from previous runs — resolve or cancel them before demo"
fi

echo ""
echo "=== Pre-warm complete ==="
echo "  KYC confidence (CUST-100442): $KYC_CONF  [expect >= 0.82]"
echo "  Recon confidence (XFER-100442-001): $RECON_CONF  [expect >= 0.80]"
echo ""
if [[ "$KYC_CONF" != "ERR" ]] && python3 -c "exit(0 if float('$KYC_CONF') >= 0.82 else 1)" 2>/dev/null; then
  echo "  Agents READY for demo."
else
  echo "  WARNING: KYC confidence below threshold — check agent health before proceeding."
fi
