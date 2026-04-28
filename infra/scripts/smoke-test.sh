#!/usr/bin/env bash
# infra/scripts/smoke-test.sh
# Port-forwards each service and verifies it responds correctly.
# Run after: make infra-up

set -euo pipefail

PASS=0
FAIL=0

ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL+1)); }

cleanup() {
  kill "$(jobs -p)" 2>/dev/null || true
}
trap cleanup EXIT

echo ""
echo "── ATOM Infrastructure Smoke Test ──────────────────────────────"

# ── Postgres ──────────────────────────────────────────────────────────────────
echo ""
echo "Postgres (pgvector)..."
if kubectl exec -n atom-infra postgres-0 -- \
     psql -U atom -d atom \
     -c "SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp','vector','pg_trgm');" \
     2>/dev/null | grep -q "vector"; then
  ok "Postgres reachable; vector extension present"
else
  fail "Postgres check failed"
fi

# ── Redis ─────────────────────────────────────────────────────────────────────
echo ""
echo "Redis..."
if kubectl exec -n atom-infra redis-master-0 -- \
     redis-cli -a changeme ping 2>/dev/null | grep -q PONG; then
  ok "Redis PONG received"
else
  fail "Redis check failed"
fi

# ── MinIO ─────────────────────────────────────────────────────────────────────
echo ""
echo "MinIO..."
MINIO_POD=$(kubectl get pod -n atom-infra -l app=minio -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if kubectl exec -n atom-infra "$MINIO_POD" -- \
     curl -sf http://localhost:9000/minio/health/live &>/dev/null; then
  ok "MinIO health endpoint OK"
else
  fail "MinIO check failed"
fi

# ── Redpanda ──────────────────────────────────────────────────────────────────
echo ""
echo "Redpanda topics..."
TOPICS=$(kubectl exec -n atom-infra redpanda-0 -- \
  rpk topic list --brokers localhost:9092 2>/dev/null || echo "")
for topic in atom.audit atom.llm atom.agent.logs atom.deployments; do
  if echo "$TOPICS" | grep -q "$topic"; then
    ok "Topic $topic exists"
  else
    fail "Topic $topic missing"
  fi
done

# ── OPA (port-forward + local curl; distroless image has no shell tools) ──────
echo ""
echo "OPA..."
kubectl port-forward svc/opa 18181:8181 -n atom-infra &>/dev/null &
OPA_PF_PID=$!
sleep 3
if curl -sf http://127.0.0.1:18181/v1/policies &>/dev/null; then
  ok "OPA /v1/policies returns 200"
else
  fail "OPA check failed"
fi
kill $OPA_PF_PID 2>/dev/null || true

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────────────────────────"
echo "  PASS: ${PASS}  FAIL: ${FAIL}"
echo ""
[[ $FAIL -eq 0 ]] && echo "All checks passed." || { echo "Some checks failed — review above."; exit 1; }
