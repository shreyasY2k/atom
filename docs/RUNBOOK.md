# ATOM Operations Runbook

Operational procedures for ATOM production deployments. Each procedure includes
the command sequence, expected output, and rollback steps.

---

## 1. Rotate the JWT Signing Key Pair

**When:** Scheduled quarterly, or immediately if the private key is suspected compromised.

**Impact:** All active agent JWTs become invalid immediately. Agents must be re-issued tokens. Human sessions (atom-studio access tokens) also expire.

```bash
# 1. Generate new RSA-4096 key pair
openssl genrsa -out .keys/jwt_private_new.pem 4096
openssl rsa -in .keys/jwt_private_new.pem -pubout -out .keys/jwt_public_new.pem

# 2. Update the Kubernetes Secret (in-place, no downtime window needed)
kubectl create secret generic atom-jwt-keys \
  --from-file=jwt_private.pem=.keys/jwt_private_new.pem \
  --from-file=jwt_public.pem=.keys/jwt_public_new.pem \
  --namespace atom-system --dry-run=client -o yaml | kubectl apply -f -

# 3. Rolling-restart all services that load the key pair
kubectl rollout restart deployment/gate            -n atom-system
kubectl rollout restart deployment/atom-studio-api -n atom-system
kubectl rollout restart deployment/atom-runtime    -n atom-system

# 4. Wait for rollouts
kubectl rollout status deployment/gate            -n atom-system --timeout=120s
kubectl rollout status deployment/atom-studio-api -n atom-system --timeout=120s
kubectl rollout status deployment/atom-runtime    -n atom-system --timeout=120s

# 5. Archive old keys in a vault (never delete until all tokens expire)
cp .keys/jwt_private.pem    vault/jwt_private_$(date +%Y%m%d).pem
cp .keys/jwt_public.pem     vault/jwt_public_$(date +%Y%m%d).pem
mv .keys/jwt_private_new.pem .keys/jwt_private.pem
mv .keys/jwt_public_new.pem  .keys/jwt_public.pem

# 6. Re-issue agent tokens: each domain admin must regenerate tokens
#    via atom-studio → Agent detail → "Regenerate token"
```

**Rollback:** Revert the Secret to the previous key files and rolling-restart again.

---

## 2. Rotate the HMAC Audit Secret

**When:** Immediately if `PLATFORM_HMAC_SECRET` is suspected leaked, or quarterly.

**Impact:** The audit hash chain breaks at the rotation point. Both old and new chains are valid but separate. Forensic validation requires knowing which secret was active at each time range.

```bash
# 1. Generate a new 32-byte secret
NEW_SECRET=$(openssl rand -hex 32)
echo "New HMAC secret: $NEW_SECRET"  # store in your vault NOW before proceeding

# 2. Record the rotation timestamp in the audit log (manual)
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) | HMAC rotation | old: ${PLATFORM_HMAC_SECRET:0:8}... | new: ${NEW_SECRET:0:8}..." \
  >> audit/hmac-rotation-log.txt

# 3. Update the Secret
kubectl get secret atom-credentials -n atom-system -o json \
  | python3 -c "
import sys, json, base64
s = json.load(sys.stdin)
s['data']['PLATFORM_HMAC_SECRET'] = base64.b64encode(b'$NEW_SECRET').decode()
print(json.dumps(s))
" | kubectl apply -f -

# 4. Rolling-restart GATE (the only service that writes the chain)
kubectl rollout restart deployment/gate -n atom-system
kubectl rollout status  deployment/gate -n atom-system --timeout=120s
```

---

## 3. Add a New LLM Provider to atom-llm

atom-llm is LiteLLM-backed. Adding a provider requires updating the LiteLLM config.

```bash
# 1. Edit atom-llm/config.yaml — add the provider entry:
#    e.g., to add Anthropic:
cat >> atom-llm/config.yaml << 'EOF'
  - model_name: claude-3-5-sonnet
    litellm_params:
      model: anthropic/claude-3-5-sonnet-20241022
      api_key: "os.environ/ANTHROPIC_API_KEY"
EOF

# 2. Add the API key to the atom-credentials Secret
kubectl get secret atom-credentials -n atom-system -o json \
  | python3 -c "
import sys, json, base64
s = json.load(sys.stdin)
s['data']['ANTHROPIC_API_KEY'] = base64.b64encode(b'$ANTHROPIC_API_KEY').decode()
print(json.dumps(s))
" | kubectl apply -f -

# 3. Rebuild + reload atom-llm image
docker build -t atom-llm:local atom-llm/ -f atom-llm/Dockerfile.dev
kind load docker-image atom-llm:local --name atom

# 4. Rolling-restart atom-llm
kubectl rollout restart deployment/atom-llm -n atom-system
kubectl rollout status  deployment/atom-llm -n atom-system --timeout=180s

# 5. Verify the new model is available
kubectl port-forward svc/atom-llm 4000:4000 -n atom-system &
curl http://localhost:4000/v1/models | python3 -m json.tool | grep claude
pkill -f "port-forward.*4000"
```

---

## 4. Add a New OPA Policy

OPA policies are hot-reloaded by GATE from the `opa-policies` ConfigMap.

```bash
# 1. Write the policy file
cat > policies/base/my_new_rule.rego << 'EOF'
package atom.authz
import future.keywords.if

deny[{"reason": "forbidden action"}] if {
    input.request.path_prefix == "/admin"
    input.token.role != "admin"
}
EOF

# 2. Write a unit test
cat > policies/tests/my_new_rule_test.rego << 'EOF'
package atom.authz_test
import future.keywords.if

test_deny_non_admin_admin_path if {
    deny[{"reason": "forbidden action"}] with input as {
        "request": {"path_prefix": "/admin"},
        "token": {"role": "developer"},
    }
}
EOF

# 3. Run tests locally
make policy-test

# 4. Update the ConfigMap (triggers GATE hot-reload within 5s)
kubectl create configmap opa-policies \
  --from-file=policies/base/ --namespace atom-system \
  --dry-run=client -o yaml | kubectl apply -f -

# 5. Verify GATE picked up the change (no restart needed)
kubectl logs deployment/gate -n atom-system --tail=20 | grep -i "policy\|opa"
```

---

## 5. Scale GATE Replicas

```bash
# Scale up (e.g., before a high-traffic event)
kubectl scale deployment/gate --replicas=6 -n atom-system

# Wait for all replicas to be ready
kubectl rollout status deployment/gate -n atom-system --timeout=120s

# Check current replicas
kubectl get deployment gate -n atom-system

# Scale back down
kubectl scale deployment/gate --replicas=3 -n atom-system

# For HPA-based autoscaling (production recommendation):
kubectl autoscale deployment gate \
  --min=3 --max=10 --cpu-percent=60 \
  -n atom-system
```

**Persistent HPA config:**
```yaml
# infra/manifests/gate-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: gate
  namespace: atom-system
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: gate
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
```

---

## 6. Restore Audit Logs from MinIO Archive

log-archiver archives `audit_log_chain` rows to MinIO bucket `atom-audit` as gzipped JSONL.

```bash
# 1. Port-forward MinIO
kubectl port-forward svc/minio 9000:9000 -n atom-infra &

# 2. Configure mc (MinIO client)
mc alias set local http://localhost:9000 minioadmin changeme

# 3. List available archives
mc ls local/atom-audit/

# 4. Download the archive for a specific date
mc cp local/atom-audit/2025-01-15.jsonl.gz /tmp/audit-2025-01-15.jsonl.gz

# 5. Inspect the archive
gunzip -c /tmp/audit-2025-01-15.jsonl.gz | head -5 | python3 -m json.tool

# 6. Restore to a staging Postgres (DO NOT restore to production without review)
gunzip -c /tmp/audit-2025-01-15.jsonl.gz | python3 - << 'EOF'
import sys, json, asyncio, asyncpg, os

async def restore():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    count = 0
    for line in sys.stdin:
        row = json.loads(line.strip())
        await conn.execute(
            """
            INSERT INTO audit_log_chain
              (id, agent_id, request_id, payload_hash, chain_hash, prev_hash, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            ON CONFLICT (id) DO NOTHING
            """,
            row['id'], row['agent_id'], row['request_id'],
            row['payload_hash'], row['chain_hash'], row['prev_hash'], row['created_at'],
        )
        count += 1
    print(f"Restored {count} rows")
    await conn.close()

asyncio.run(restore())
EOF

pkill -f "port-forward.*9000"
```

---

## 7. Validate the Audit Hash Chain

The HMAC-SHA256 hash chain ensures tamper-evidence: each row's `chain_hash` covers
`payload_hash + prev_hash` keyed by `PLATFORM_HMAC_SECRET`.

```bash
# Port-forward Postgres first
kubectl port-forward svc/postgres 5432:5432 -n atom-infra &

python3 << 'EOF'
import asyncio, asyncpg, hmac, hashlib, os

async def validate():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    secret = os.environ['PLATFORM_HMAC_SECRET'].encode()
    rows = await conn.fetch(
        'SELECT id, payload_hash, chain_hash, prev_hash FROM audit_log_chain ORDER BY id'
    )
    errors = []
    for row in rows:
        msg = (row['payload_hash'] + (row['prev_hash'] or '')).encode()
        expected = hmac.new(secret, msg, hashlib.sha256).hexdigest()
        if expected != row['chain_hash']:
            errors.append(f"Row {row['id']}: chain broken (expected {expected[:8]}..., got {row['chain_hash'][:8]}...)")
    if errors:
        print(f"CHAIN BROKEN: {len(errors)} error(s)")
        for e in errors[:10]:
            print(" ", e)
    else:
        print(f"Chain valid — {len(rows)} rows verified.")
    await conn.close()

asyncio.run(validate())
EOF

pkill -f "port-forward.*5432"
```

---

## 8. Suspend an Agent

Suspension revokes the agent's token and scales its deployment to 0 replicas.

```bash
# Set these variables
DOMAIN_ID="<domain-uuid>"
AGENT_ID="<agent-uuid>"
STUDIO_URL="http://studio.atom.local:8088"   # or http://localhost:3001 for docker-compose

# 1. Login to get an access token
TOKEN=$(curl -s -X POST $STUDIO_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 2. Revoke all active tokens for this agent
curl -s -X POST "$STUDIO_URL/api/domains/$DOMAIN_ID/agents/$AGENT_ID/regenerate-token" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# 3. Scale agent deployment to 0 in atom-agents namespace
DEP_NAME="agent-$AGENT_ID"
kubectl scale deployment/$DEP_NAME --replicas=0 -n atom-agents 2>/dev/null \
  && echo "Deployment scaled to 0" \
  || echo "No deployment found (agent was not deployed)"

# 4. Mark agent as suspended in the database
kubectl port-forward svc/postgres 5432:5432 -n atom-infra &
sleep 1
PGPASSWORD=changeme psql -h localhost -U atom -d atom \
  -c "UPDATE agents SET status='suspended', updated_at=now() WHERE id='$AGENT_ID';"

pkill -f "port-forward"

echo "Agent $AGENT_ID suspended. Re-enable by issuing a new token and scaling replicas back to 1."
```
