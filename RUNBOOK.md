# ATOM — Operational Runbook

Procedures for platform administrators.

**Conventions:**
- `$STUDIO_URL` = `http://studio.atom.local` (kind) or `http://localhost:3001` (docker-compose)
- `$GATE_URL` = `http://gate.atom.local` (kind) or `http://localhost:8080` (docker-compose)
- Admin token: login at `$STUDIO_URL/api/auth/login` with `admin@atom.local / admin123`

---

## 1. Rotate the JWT signing key pair

**When:** Every 90 days or on suspected private key compromise.

**Impact:** All existing agent JWTs become invalid immediately. Agents must be redeployed with new tokens.

```bash
# 1. Generate new RSA-4096 key pair locally
openssl genrsa -out .keys/jwt_private_new.pem 4096
openssl rsa -in .keys/jwt_private_new.pem -pubout -out .keys/jwt_public_new.pem

# 2. Update the k8s Secret in atom-system
kubectl create secret generic atom-jwt-keys \
  --from-file=jwt_private.pem=.keys/jwt_private_new.pem \
  --from-file=jwt_public.pem=.keys/jwt_public_new.pem \
  -n atom-system --dry-run=client -o yaml | kubectl apply -f -

# 3. Rolling restart all services that load the key pair
kubectl rollout restart deployment/gate deployment/atom-studio-api deployment/atom-runtime \
  -n atom-system
kubectl rollout status deployment/gate deployment/atom-studio-api -n atom-system

# 4. Revoke all existing agent tokens in Postgres
kubectl port-forward svc/postgres-postgresql 5432:5432 -n atom-infra &
sleep 2
PGPASSWORD=changeme psql -h localhost -U atom -d atom \
  -c "UPDATE agent_tokens SET revoked_at=now() WHERE revoked_at IS NULL;"

# 5. Replace local key files
mv .keys/jwt_private_new.pem .keys/jwt_private.pem
mv .keys/jwt_public_new.pem  .keys/jwt_public.pem

# 6. For each deployed agent: regenerate token in Studio, then redeploy
#    Studio → Agent → Regenerate Token → atom deploy
pkill -f "kubectl port-forward.*5432" 2>/dev/null || true
```

---

## 2. Rotate the HMAC audit secret

**When:** Every 180 days or on suspected secret compromise.

```bash
NEW_SECRET=$(openssl rand -hex 32)
echo "New secret (store in vault): $NEW_SECRET"

# Record the current chain length before rotation
kubectl port-forward svc/postgres-postgresql 5432:5432 -n atom-infra &
sleep 2
ROTATION_SEQ=$(PGPASSWORD=changeme psql -h localhost -U atom -d atom -tA \
  -c "SELECT COALESCE(MAX(seq),0) FROM audit_log_chain;")
echo "Rotating at seq: $ROTATION_SEQ"

# Update the k8s Secret
kubectl get secret atom-credentials -n atom-system -o json \
  | python3 -c "
import sys,json,base64
s=json.load(sys.stdin)
s['data']['PLATFORM_HMAC_SECRET']=base64.b64encode(b'$NEW_SECRET').decode()
print(json.dumps(s))" | kubectl apply -f -

# Restart GATE (only service that writes the chain)
kubectl rollout restart deployment/gate -n atom-system
kubectl rollout status deployment/gate -n atom-system

pkill -f "kubectl port-forward.*5432" 2>/dev/null || true
echo "Entries from seq $((ROTATION_SEQ+1)) onwards use the new secret."
```

---

## 3. Add a new LLM provider to atom-llm

```bash
# 1. Edit atom-llm/config.dev.yaml — add to model_list:
#    - model_name: claude-3-5-sonnet
#      litellm_params:
#        model: anthropic/claude-3-5-sonnet-20241022
#        api_key: "os.environ/ANTHROPIC_API_KEY"

# 2. Add the API key to the atom-credentials Secret
kubectl get secret atom-credentials -n atom-system -o json \
  | python3 -c "
import sys,json,base64
s=json.load(sys.stdin)
s['data']['ANTHROPIC_API_KEY']=base64.b64encode(b'$ANTHROPIC_API_KEY').decode()
print(json.dumps(s))" | kubectl apply -f -

# 3. Rebuild and deploy atom-llm
docker build -t ghcr.io/shreyasy2k/atom-llm:latest atom-llm/ -f atom-llm/Dockerfile.dev
kind load docker-image ghcr.io/shreyasy2k/atom-llm:latest --name atom
kubectl rollout restart deployment/atom-llm -n atom-system
kubectl rollout status deployment/atom-llm -n atom-system

# 4. Verify new model appears
kubectl port-forward svc/atom-llm 4000:4000 -n atom-system &
sleep 2
curl -s -H "Authorization: Bearer $LITELLM_MASTER_KEY" http://localhost:4000/v1/models \
  | python3 -c "import sys,json; [print(m['id']) for m in json.load(sys.stdin)['data']]"
pkill -f "kubectl port-forward.*atom-llm" 2>/dev/null || true
```

---

## 4. Add a new OPA policy

GATE hot-reloads policies within 5 seconds — no restart needed.

```bash
# 1. Write the policy
cat > policies/base/my_policy.rego << 'EOF'
package atom.authz
import future.keywords.if

deny[{"reason": "external tools restricted after hours"}] if {
    hour := time.clock(time.now_ns())[0]
    hour >= 18
    startswith(input.request.path, "/tools/external/")
}
EOF

# 2. Write a unit test
cat > policies/tests/my_policy_test.rego << 'EOF'
package atom.authz_test
import future.keywords.if

test_deny_after_hours if {
    deny[_] with input as {
        "request": {"path": "/tools/external/send-email"},
        "token": {"type": "agent"}
    } with time.now_ns as 1700000000000000000
}
EOF

# 3. Test
make policy-test

# 4. Update the ConfigMap (triggers GATE hot-reload)
kubectl create configmap opa-policies \
  --from-file=policies/base/ -n atom-system \
  --dry-run=client -o yaml | kubectl apply -f -
```

---

## 5. Scale GATE replicas

GATE is stateless — any number of replicas is safe.

```bash
# Scale up
kubectl scale deployment gate --replicas=5 -n atom-system
kubectl rollout status deployment/gate -n atom-system

# HPA (production recommendation)
kubectl autoscale deployment gate --min=3 --max=10 --cpu-percent=60 -n atom-system

# Scale down
kubectl scale deployment gate --replicas=3 -n atom-system
```

---

## 6. Restore from MinIO audit archive

```bash
# Port-forward MinIO
kubectl port-forward svc/minio 9000:9000 -n atom-infra &
sleep 2
mc alias set local http://localhost:9000 minioadmin changeme

# List archives
mc ls local/atom-audit/ --recursive | head -20

# Download a time range
mc cp --recursive local/atom-audit/2025/01/15/ ./audit-restore/

# Inspect with DuckDB
docker run --rm -v $(pwd)/audit-restore:/data datacatering/duckdb \
  "SELECT timestamp, domain_id, agent_id, method, path, status_code
   FROM read_ndjson_auto('/data/**/*.jsonl')
   WHERE agent_id = 'your-agent-uuid'
   ORDER BY timestamp LIMIT 100;"

pkill -f "kubectl port-forward.*minio" 2>/dev/null || true
```

---

## 7. Validate the audit hash chain

**Via atom-studio UI:** Audit Log → **Verify Chain** button.

**Via CLI:**

```bash
kubectl port-forward svc/postgres-postgresql 5432:5432 -n atom-infra &
sleep 2
PGPASSWORD=changeme psql -h localhost -U atom -d atom << 'EOSQL'
DO $$
DECLARE
  rec          RECORD;
  prev_event   TEXT := 'genesis';
  computed     TEXT;
  ok           BOOLEAN := TRUE;
BEGIN
  FOR rec IN SELECT seq, prev_hash, event::text FROM audit_log_chain ORDER BY seq
  LOOP
    computed := encode(sha256(prev_event::bytea), 'hex');
    IF rec.prev_hash != computed THEN
      RAISE NOTICE 'CHAIN BROKEN at seq=%', rec.seq;
      ok := FALSE; EXIT;
    END IF;
    prev_event := rec.event::text;
  END LOOP;
  IF ok THEN RAISE NOTICE 'Chain valid — all entries verified'; END IF;
END; $$;
EOSQL
pkill -f "kubectl port-forward.*5432" 2>/dev/null || true
```

---

## 8. Suspend an agent

```bash
AGENT_ID="your-agent-uuid"
DOMAIN_ID="your-domain-uuid"

# Login
TOKEN=$(curl -s -X POST $STUDIO_URL/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@atom.local","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# 1. Revoke token (GATE refuses it within milliseconds via Redis)
curl -s -X POST "$STUDIO_URL/api/domains/$DOMAIN_ID/agents/$AGENT_ID/regenerate-token" \
  -H "Authorization: Bearer $TOKEN"
# Old token is now blacklisted; new token returned but not used

# 2. Scale pod to 0
kubectl scale deployment "agent-$AGENT_ID" --replicas=0 -n atom-agents 2>/dev/null || true

# 3. Mark suspended in DB
kubectl port-forward svc/postgres-postgresql 5432:5432 -n atom-infra &
sleep 2
PGPASSWORD=changeme psql -h localhost -U atom -d atom \
  -c "UPDATE agents SET status='suspended', updated_at=now() WHERE id='$AGENT_ID';"
pkill -f "kubectl port-forward.*5432" 2>/dev/null || true
```

---

## 9. Rebuild the kind cluster from scratch

```bash
# 1. Export data (optional)
kubectl port-forward svc/postgres-postgresql 5432:5432 -n atom-infra &
sleep 2
PGPASSWORD=changeme pg_dump -h localhost -U atom atom | gzip > atom-backup-$(date +%Y%m%d).sql.gz
pkill -f "kubectl port-forward.*5432" 2>/dev/null || true

# 2. Tear down
kind delete cluster --name atom

# 3. Rebuild
make infra-up           # creates kind cluster + deploys Postgres, Redis, MinIO, Redpanda, OPA
make k8s-deploy         # builds + loads images, applies manifests, runs migrations + seed
make monitoring-up      # Grafana + Loki + Tempo + Alloy
sudo make ingress-hosts # /etc/hosts entries (if not already done)
make ingress-up         # nginx ingress on port 80
```

---

## Quick Reference

| Action | Where | Time |
|--------|-------|------|
| View HITL queue | Studio → HITL | instant |
| View audit log | Studio → Audit Log | instant |
| Verify chain | Studio → Audit Log → Verify Chain | ~30s |
| Rotate JWT keys | CLI §1 | ~10 min |
| Rotate HMAC secret | CLI §2 | ~5 min |
| Add LLM provider | Edit config + rebuild atom-llm §3 | ~10 min |
| Add OPA policy | Rego file + ConfigMap update §4 | ~5 min |
| Scale GATE | `kubectl scale` §5 | ~2 min |
| Suspend agent | Studio UI or CLI §8 | < 1 min |
| Full cluster rebuild | `make infra-up && make k8s-deploy` §9 | ~20 min |
