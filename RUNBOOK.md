# ATOM — Operational Runbook

Procedures for platform administrators. Each section is self-contained and safe to run
without reading the others.

---

## Table of Contents

1. [Rotate the JWT signing key pair](#1-rotate-the-jwt-signing-key-pair)
2. [Rotate the HMAC audit secret](#2-rotate-the-hmac-audit-secret)
3. [Add a new LLM provider to atom-llm](#3-add-a-new-llm-provider-to-atom-llm)
4. [Add a new OPA policy](#4-add-a-new-opa-policy)
5. [Scale GATE replicas](#5-scale-gate-replicas)
6. [Restore from MinIO audit archive](#6-restore-from-minio-audit-archive)
7. [Validate the audit hash chain](#7-validate-the-audit-hash-chain)
8. [Suspend an agent](#8-suspend-an-agent)
9. [Unsuspend an agent](#9-unsuspend-an-agent)
10. [Rebuild the kind cluster from scratch](#10-rebuild-the-kind-cluster-from-scratch)

---

## 1. Rotate the JWT signing key pair

**When:** Scheduled key rotation (recommend every 90 days) or suspected key compromise.

**Impact:** All existing human session tokens and agent JWTs are invalidated. Human users
must log in again. All deployed agents must be redeployed with new JWTs.

**Steps:**

```bash
# 1. Generate new RSA-4096 key pair
openssl genrsa -out jwt_private_new.pem 4096
openssl rsa -in jwt_private_new.pem -pubout -out jwt_public_new.pem

# 2. Update atom-studio secret (private + public key)
kubectl create secret generic atom-jwt-keys \
  --from-file=jwt_private.pem=jwt_private_new.pem \
  --from-file=jwt_public.pem=jwt_public_new.pem \
  -n atom-system --dry-run=client -o yaml | kubectl apply -f -

# 3. Update GATE secret (public key only)
kubectl create secret generic atom-gate-config \
  --from-file=jwt_public.pem=jwt_public_new.pem \
  -n atom-system --dry-run=client -o yaml | kubectl apply -f -

# 4. Rolling restart atom-studio (picks up new private key)
kubectl rollout restart deployment/atom-studio -n atom-system
kubectl rollout status deployment/atom-studio -n atom-system

# 5. Rolling restart GATE (picks up new public key)
kubectl rollout restart deployment/gate -n atom-system
kubectl rollout status deployment/gate -n atom-system

# 6. Revoke all existing agent tokens in Postgres
psql $DATABASE_URL -c "
  UPDATE agent_tokens
  SET revoked_at = now(), revoked_by = NULL
  WHERE revoked_at IS NULL;
"

# 7. For each deployed agent: regenerate token in studio UI
#    Then redeploy: atom deploy (from agent project directory)
#    This provisions a new JWT signed with the new key

# 8. Shred old key files
shred -u jwt_private_new.pem jwt_public_new.pem
```

**Verification:**
```bash
# GATE should accept tokens signed with new key
curl -H "Authorization: Bearer $(atom token print)" \
  https://atom.internal/healthz
# → 200 OK
```

---

## 2. Rotate the HMAC audit secret

**When:** Scheduled rotation (recommend every 180 days) or suspected secret compromise.

**Impact:** The hash chain is NOT broken. The new secret applies to all new entries going
forward. Old entries remain valid under the old secret. The validator must be told the
rotation point.

**Steps:**

```bash
# 1. Generate new 32-byte hex secret
NEW_SECRET=$(openssl rand -hex 32)

# 2. Record the rotation point (last seq before rotation)
ROTATION_SEQ=$(psql $DATABASE_URL -t -c "SELECT MAX(seq) FROM audit_log_chain;")
echo "Rotation at seq: $ROTATION_SEQ — record this"

# 3. Store rotation event in audit chain itself (last entry under old secret)
#    This is done by the GATE rotation endpoint (requires admin JWT)
curl -X POST https://atom.internal/admin/audit/rotate-hmac \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"rotation_seq": '$ROTATION_SEQ'}'

# 4. Update the k8s secret with new HMAC secret
kubectl create secret generic atom-gate-config \
  --from-literal=PLATFORM_HMAC_SECRET=$NEW_SECRET \
  -n atom-system --dry-run=client -o yaml | kubectl apply -f -

# 5. Rolling restart GATE
kubectl rollout restart deployment/gate -n atom-system
kubectl rollout status deployment/gate -n atom-system

# 6. Record the rotation in an operations log with:
#    - Date of rotation
#    - rotation_seq value
#    - Previous secret hash (sha256 of old secret, NOT the secret itself)
echo "Rotation recorded. New entries from seq $((ROTATION_SEQ+1)) use new secret."
```

**Note for chain validation after rotation:**
The audit validator in atom-studio reads a `hmac_rotations` table that records
`(rotation_seq, secret_hash)` entries. Entries at seq ≤ rotation_seq are validated
with the old secret; entries after use the new secret.

---

## 3. Add a new LLM provider to atom-llm

**When:** Onboarding a new model endpoint (e.g. Azure OpenAI, a self-hosted Mistral, new Anthropic model).

**Impact:** Zero downtime. atom-llm picks up new provider config on restart.

**Steps:**

```bash
# 1. Add provider credentials to atom-llm config secret
kubectl edit secret atom-llm-providers -n atom-system
# Add new key, e.g.: AZURE_OPENAI_API_KEY=sk-...
# Or for a self-hosted endpoint: SELF_HOSTED_LLM_URL=http://...

# 2. Add the model to atom-llm's LiteLLM config file
kubectl edit configmap atom-llm-config -n atom-system
# In litellm_settings.model_list, add:
#   - model_name: azure-gpt-4o
#     litellm_params:
#       model: azure/gpt-4o
#       api_base: https://your-deployment.openai.azure.com/
#       api_key: os.environ/AZURE_OPENAI_API_KEY
#       api_version: "2024-02-01"

# 3. Rolling restart atom-llm
kubectl rollout restart deployment/atom-llm -n atom-system
kubectl rollout status deployment/atom-llm -n atom-system

# 4. Verify the new model appears in atom-llm's model list
kubectl port-forward svc/atom-llm 4000:4000 -n atom-system &
curl http://localhost:4000/models | jq '.data[].id'
# Should include "azure-gpt-4o"

# 5. Update allowed_models for any agents that should access the new model
#    via atom-studio: Agent detail → Edit → add model to allowed list
#    OR via API:
curl -X PATCH https://atom.internal/api/domains/{did}/agents/{aid} \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"allowed_models": ["gpt-4o", "azure-gpt-4o"]}'
```

---

## 4. Add a new OPA policy

**When:** New access control requirement (domain restriction, tool deny-list, rate tier, compliance rule).

**Impact:** Zero downtime. GATE hot-reloads policies within 5 seconds of file change.

**Steps:**

```bash
# 1. Create the Rego file in policies/base/ (or policies/custom/ for org-specific)
cat > policies/base/my_new_policy.rego << 'EOF'
package atom.authz
import future.keywords.if

# Example: deny agents from calling external tools after 18:00 UTC
deny[{"reason": "external tools not permitted outside business hours"}] if {
    hour := time.clock(time.now_ns())[0]
    hour >= 18
    startswith(input.request.path, "/tools/external/")
}
EOF

# 2. Write a unit test
cat > policies/tests/my_new_policy_test.rego << 'EOF'
package atom.authz_test
import future.keywords.if

test_deny_after_hours if {
    deny[_] with input as {
        "request": {"path": "/tools/external/send-email", "method": "POST"},
        "token": {"type": "agent"}
    } with time.now_ns as 1700000000000000000  # 18:13 UTC
}
EOF

# 3. Run tests locally
make policy-test
# → PASS

# 4. Build and validate the bundle
make policy-bundle
# → policies/bundle.tar.gz

# 5. Commit and push
git add policies/
git commit -m "feat(policy): deny external tools after business hours"

# 6. Apply to running cluster
#    Option A: ConfigMap reload (dev)
kubectl create configmap atom-opa-policies \
  --from-file=policies/base/ \
  -n atom-system --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment/gate -n atom-system

#    Option B: Bundle API (prod) — upload bundle.tar.gz to MinIO, GATE auto-reloads
mc cp policies/bundle.tar.gz minio/atom-policies/bundle.tar.gz

# 7. Verify hot-reload in GATE logs
kubectl logs -l app=gate -n atom-system --tail=20 | grep "policy bundle reloaded"
```

**Testing the new policy without deploying:**
```bash
# Use the OPA REPL against the policies directory
opa run policies/base/ --stdin-input << 'EOF'
{
  "input": {
    "request": {"path": "/tools/external/send-email", "method": "POST"},
    "token": {"type": "agent", "agent_id": "test-123"}
  }
}
EOF
# Check data.atom.authz.deny output
```

---

## 5. Scale GATE replicas

**When:** Load increase, planned maintenance on a node, or HA hardening.

**Steps:**

```bash
# Scale up
kubectl scale deployment gate --replicas=5 -n atom-system
kubectl rollout status deployment/gate -n atom-system

# Verify all replicas healthy
kubectl get pods -l app=gate -n atom-system
# NAME                   READY   STATUS    RESTARTS
# gate-abc-1             1/1     Running   0
# gate-def-2             1/1     Running   0
# gate-ghi-3             1/1     Running   0
# gate-jkl-4             1/1     Running   0
# gate-mno-5             1/1     Running   0

# Scale down
kubectl scale deployment gate --replicas=3 -n atom-system
```

**Important:** GATE is stateless (all state in Postgres + Redis). Any number of replicas
is safe. The nginx ingress load-balances across them.

**Audit chain note:** Multiple GATE replicas write to `audit_log_chain` concurrently.
The `seq` bigserial is assigned by Postgres atomically — no gaps, no duplicates.
The `prev_hash` is computed from the Postgres row immediately before the INSERT using
a SELECT FOR UPDATE (advisory lock on the audit table). This is intentional; it is
the one place GATE waits on Postgres to preserve chain integrity.

**HPA (optional):**
```bash
kubectl autoscale deployment gate \
  --min=3 --max=10 \
  --cpu-percent=60 \
  -n atom-system
```

---

## 6. Restore from MinIO audit archive

**When:** Disaster recovery, compliance audit request for a historical period, or
Postgres `audit_log_chain` table corruption/loss.

**Steps:**

```bash
# 1. List available archive files
mc ls minio/atom-audit/atom.audit/ --recursive | head -20
# atom-audit/atom.audit/2025/01/15/12/batch-uuid.jsonl

# 2. Download the relevant time range
mc cp --recursive \
  minio/atom-audit/atom.audit/2025/01/15/ \
  ./audit-restore/2025-01-15/

# 3. Inspect with DuckDB (fast, no install needed with Docker)
docker run --rm -v $(pwd)/audit-restore:/data \
  datacatering/duckdb:latest \
  "SELECT timestamp, domain_id, agent_id, method, path, status_code
   FROM read_ndjson_auto('/data/2025-01-15/**/*.jsonl')
   WHERE agent_id = 'your-agent-uuid'
   ORDER BY timestamp
   LIMIT 100;"

# 4. Restore to Postgres (if audit_log_chain was lost)
#    Note: restoring rebuilds the table data but the chain HMACs will not match
#    the live secret unless you also restore the secret from the time of the original entries.
#    Treat restored entries as "read-only archive" — do not append new entries to a restored chain.
psql $DATABASE_URL << 'EOF'
CREATE TABLE IF NOT EXISTS audit_log_chain_restored (LIKE audit_log_chain);
\copy audit_log_chain_restored FROM '/path/to/extracted.csv' CSV HEADER;
EOF

# 5. For a compliance export (PDF/CSV of all entries for an agent/time range):
mc cat minio/atom-audit/atom.audit/2025/01/15/12/batch-uuid.jsonl \
  | jq -r '[.timestamp,.domain_id,.agent_id,.method,.path,.status_code] | @csv' \
  > compliance-export-2025-01-15.csv
```

---

## 7. Validate the audit hash chain

**When:** Routine integrity check, compliance audit, or suspicion of tampering.

**Via atom-studio UI:**
1. Navigate to **Audit Log** → click **Verify Chain**.
2. Studio runs the validator and shows: `Chain valid — N entries verified` or
   `Chain broken at seq=N (entry id=...)`.

**Via CLI (for scripted/scheduled checks):**

```bash
# Validate the entire chain
psql $DATABASE_URL << 'EOSQL'
DO $$
DECLARE
  rec         RECORD;
  prev_event  TEXT := 'genesis';
  computed_hash TEXT;
  ok          BOOLEAN := TRUE;
BEGIN
  FOR rec IN
    SELECT seq, prev_hash, event::text AS event_text, hmac
    FROM audit_log_chain ORDER BY seq
  LOOP
    computed_hash := encode(sha256(prev_event::bytea), 'hex');
    IF rec.prev_hash != computed_hash THEN
      RAISE NOTICE 'CHAIN BROKEN at seq=% — prev_hash mismatch', rec.seq;
      ok := FALSE;
      EXIT;
    END IF;
    prev_event := rec.event_text;
  END LOOP;

  IF ok THEN RAISE NOTICE 'Chain valid — all entries verified'; END IF;
END;
$$;
EOSQL

# For HMAC validation (requires PLATFORM_HMAC_SECRET in environment):
# Run the Go validator binary shipped with GATE
./gate/tools/audit-validator \
  --database-url "$DATABASE_URL" \
  --hmac-secret "$PLATFORM_HMAC_SECRET" \
  --start-seq 1 \
  --end-seq 0  # 0 = up to latest
```

**Scheduled validation (cron):**
```yaml
# infra/manifests/audit-validator-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
spec:
  schedule: "0 2 * * *"   # 02:00 UTC daily
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: validator
            image: atom-gate:latest
            command: ["/audit-validator", "--full"]
            envFrom:
            - secretRef: { name: atom-gate-config }
```

---

## 8. Suspend an agent

**When:** Security incident, policy violation, agent behaving unexpectedly, or during maintenance.

**Impact:** Immediate — all in-flight requests to the agent return 503 within seconds.
The agent's k8s pod continues running but GATE stops routing to it.

**Steps:**

```bash
AGENT_ID="your-agent-uuid"
ADMIN_JWT="your-admin-token"

# 1. Revoke the agent token (GATE stops accepting requests immediately)
curl -X POST https://atom.internal/api/domains/{did}/agents/$AGENT_ID/revoke-token \
  -H "Authorization: Bearer $ADMIN_JWT"

# This sets:
#   agent_tokens.revoked_at = now()
#   Redis SET token_revoked:{hash} 1 EX 86400
# GATE checks Redis on every request — takes effect within milliseconds.

# 2. Update agent status in Postgres
psql $DATABASE_URL -c "
  UPDATE agents SET status='suspended', updated_at=now()
  WHERE id='$AGENT_ID';
"

# 3. (Optional) Scale down the agent pod to save resources
kubectl scale deployment agent-$AGENT_ID --replicas=0 -n atom-agents

# 4. Verify: test request should return 401
curl -X POST "https://atom.internal/domain/{did}/agent/$AGENT_ID/run" \
  -H "Authorization: Bearer {old-agent-jwt}"
# → 401 { "error": "token_revoked" }
```

---

## 9. Unsuspend an agent

**When:** Incident resolved, maintenance complete.

**Steps:**

```bash
AGENT_ID="your-agent-uuid"
DOMAIN_ID="your-domain-uuid"

# 1. Generate a new agent token in atom-studio
#    UI: Agents → agent detail → "Regenerate Token"
#    This issues a new JWT and stores new hash in agent_tokens.
#    Old revoked token remains in table with revoked_at set.

# 2. Update agent status
psql $DATABASE_URL -c "
  UPDATE agents SET status='draft', updated_at=now()
  WHERE id='$AGENT_ID';
"

# 3. Redeploy with new token
cd /path/to/agent-project
# Update .env with the new token from studio
atom deploy
# Submit deployment → approve in studio → atom-runtime scales pod back up
# atom-runtime will also update agents.status = 'deployed' on success

# 4. Verify
curl -X POST "https://atom.internal/domain/$DOMAIN_ID/agent/$AGENT_ID/run" \
  -H "Authorization: Bearer {new-agent-jwt}"
# → 200 OK
```

---

## 10. Rebuild the kind cluster from scratch

**When:** Corrupted cluster state, major version upgrade, or clean environment for a new developer.

**Important:** Postgres, Redis, and MinIO data live in Docker volumes inside kind nodes.
A cluster teardown destroys all data unless you have external persistent volumes or backups.

**Steps:**

```bash
# 1. (If cluster is accessible) Backup Postgres
kubectl exec -n atom-infra deploy/postgres -- \
  pg_dump -U postgres atom | gzip > atom-backup-$(date +%Y%m%d).sql.gz

# 2. Export MinIO audit data
mc mirror minio/atom-audit ./minio-backup-$(date +%Y%m%d)/

# 3. Tear down
make infra-down
# → kind delete cluster --name atom

# 4. Rebuild
make infra-up
# → kind create cluster --config infra/kind/cluster.yaml --name atom
# → helm installs postgres, redis, minio, redpanda, opa, ingress-nginx

# 5. Run migrations
make migrate-up

# 6. (Optional) Restore Postgres backup
gunzip -c atom-backup-YYYYMMDD.sql.gz | \
  kubectl exec -i -n atom-infra deploy/postgres -- psql -U postgres atom

# 7. Restart all ATOM services
kubectl rollout restart deployment/gate deployment/atom-llm deployment/atom-studio \
  deployment/atom-runtime deployment/atom-memory -n atom-system

# 8. Re-register atom-runtime with studio
kubectl rollout status deployment/atom-runtime -n atom-system
# atom-runtime registers its webhook URL with studio on startup automatically

# 9. Redeploy any agents that were running
#    Either via atom-studio UI (Agents → Deploy) or:
atom deploy  # from each agent's project directory
```

---

## Quick Reference

| Action | Where | Time |
|---|---|---|
| View HITL queue | atom-studio → HITL | instant |
| View audit log | atom-studio → Audit Log | instant |
| Verify chain integrity | atom-studio → Audit Log → Verify Chain | ~30s |
| Rotate JWT keys | CLI (see §1) | ~10 min |
| Rotate HMAC secret | CLI (see §2) | ~5 min |
| Add LLM provider | ConfigMap edit + rollout (see §3) | ~5 min |
| Add OPA policy | Rego file + commit + ConfigMap (see §4) | ~10 min |
| Scale GATE | `kubectl scale` (see §5) | ~2 min |
| Suspend agent | Studio UI or CLI (see §8) | < 1 min |
| Unsuspend agent | Regenerate token + `atom deploy` (see §9) | ~5 min |
| Full cluster rebuild | `make infra-down && make infra-up` (see §10) | ~15 min |
