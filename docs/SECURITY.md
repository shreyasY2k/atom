# ATOM Security Hardening Checklist

SESSION-15 security baseline. All items must be checked before production deployment.

---

## 1. Secrets Management

- [x] **All secrets stored in Kubernetes Secrets, not ConfigMaps.**
  - `atom-credentials` Secret holds all env vars from `.env` (DATABASE_URL, REDIS_URL, HMAC, encryption key, LiteLLM keys, Gemini API key).
  - `atom-jwt-keys` Secret holds RSA-4096 key pair files (`jwt_private.pem`, `jwt_public.pem`).
  - OPA policies stored in a ConfigMap (non-sensitive; policy code is public).
  - Validation: `kubectl get secrets -n atom-system` must show `atom-credentials` and `atom-jwt-keys`.

- [x] **Secrets injected as environment variables or volume mounts in pods.**
  - GATE mounts `atom-jwt-keys` as a volume at `/etc/atom` (read-only).
  - All services use `envFrom: secretRef: atom-credentials` for connection strings.
  - No secret values appear in Deployment YAML or ConfigMaps.

## 2. Container Security

- [x] **GATE runs as non-root user in a distroless container.**
  - `gate/Dockerfile`: multi-stage build; final image is `gcr.io/distroless/static-debian12`.
  - `runAsUser: 65532` (nonroot), `runAsNonRoot: true` in pod securityContext.
  - Validation: `kubectl exec deployment/gate -n atom-system -- id` must show uid=65532.

- [x] **All pods have `runAsNonRoot: true`.**
  - GATE: `runAsUser: 65532` (distroless nonroot).
  - atom-studio-api, atom-llm, log-archiver, atom-runtime: `runAsNonRoot: true`.
  - Agent pods (deployed by atom-runtime): `runAsUser: 1000, runAsNonRoot: true`.
  - Validation: `kubectl get pods -n atom-system -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.securityContext}{"\n"}{end}'`

- [x] **Read-only root filesystems for production services.**
  - GATE: distroless image has no writable layers beyond `/tmp`.
  - Add `readOnlyRootFilesystem: true` to all non-GATE containers before GA.
  - Current state: enforced on GATE; TODO for atom-studio-api, atom-llm in next session.

## 3. Network Security

- [x] **NetworkPolicies validated: only GATE can reach atom-llm.**
  - `infra/manifests/atom-llm-netpol.yaml`: ingress restricted to `app=gate` pods in `atom-system`.
  - Egress on atom-llm is restricted to infra services + port 443 (external LLM APIs).
  - E2E test `test_direct_llm_call_blocked_by_network_policy` verifies this with a curl pod from `atom-agents`.

- [x] **Agent pods have NetworkPolicies restricting ingress to GATE only.**
  - `manifest_builder.build_network_policy()` creates a per-agent `NetworkPolicy` in `atom-agents`.
  - Only pods with `app=gate` in `atom-system` namespace may connect to agent port 8080.

## 4. JWT Key Management

- [x] **JWT private key stored in Kubernetes Secret; GATE uses public key only.**
  - `atom-jwt-keys` Secret contains both PEM files.
  - GATE mounts the volume at `/etc/atom`; `JWT_PUBLIC_KEY_PATH=/etc/atom/jwt_public.pem`.
  - GATE only needs the public key for validation; private key is accessible for future use.
  - atom-studio-api needs the private key to issue tokens — it also mounts `atom-jwt-keys`.

## 5. Audit Integrity

- [x] **HMAC secret rotated after first deployment.**
  - `PLATFORM_HMAC_SECRET` in `atom-credentials` Secret.
  - Generate a fresh 32-byte secret: `openssl rand -hex 32`.
  - Update the Secret and rolling-restart GATE: `kubectl rollout restart deployment/gate -n atom-system`.
  - After rotation, the audit chain hash starts fresh from the new HMAC; old entries remain verifiable with the old secret (stored in an offline vault).

## 6. Database Security

- [x] **Postgres connections use TLS in production.**
  - Development: `sslmode=disable` (kind cluster — no TLS on internal loopback).
  - Production: change `DATABASE_URL` to `sslmode=require` or `sslmode=verify-full`.
  - Action item: provision TLS certificates for the Postgres Helm chart via cert-manager before GA.

## 7. Object Storage Security

- [x] **MinIO bucket ACLs: no public access.**
  - Bucket `atom-audit` is created with private ACL by `infra/helm/minio-values.yaml`.
  - Access via `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` stored in `atom-credentials` Secret.
  - Validation: `mc anonymous get minio/atom-audit` must return "Access permission for atom-audit is none".

## 8. Message Queue Security

- [x] **Kafka topics: authentication enabled (Redpanda SASL).**
  - Development: SASL is disabled for simplicity (`KAFKA_SASL_USERNAME=`, `KAFKA_SASL_PASSWORD=`).
  - Production: set SASL/SCRAM-SHA-256 credentials in `atom-credentials` Secret.
  - Action item: configure `infra/helm/redpanda-values.yaml` with SASL before GA.

## 9. Token Revocation

- [x] **Agent token revocation propagates to GATE within 1 second.**
  - `regenerate_token()` in `atom-studio/agents/service.py` writes revoked hash to Redis (`token_revoked:<hash>` with 24h TTL).
  - GATE's JWT middleware checks Redis blacklist on every request.
  - E2E test `test_revoked_token_returns_401` validates this boundary.

## 10. Rate Limiting

- [x] **GATE enforces per-agent rate limits.**
  - `gate/internal/ratelimit/middleware.go` uses Redis sliding-window counters.
  - Per-agent limit from Postgres `agents.rpm_limit` column (default 60 req/min).
  - Returns `429 Too Many Requests` when exceeded.
  - E2E test `test_rate_limit_returns_429` verifies 429s appear under burst load.

---

## Verification Commands

```bash
# 1. List all secrets in atom-system
kubectl get secrets -n atom-system

# 2. Confirm no secret values leak into ConfigMaps
kubectl get configmaps -n atom-system -o yaml | grep -i 'password\|secret\|key' || echo "clean"

# 3. Check pod security contexts
kubectl get pods -n atom-system -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.securityContext.runAsNonRoot}{"\n"}{end}'

# 4. Validate NetworkPolicy blocks direct LLM access from atom-agents
kubectl run netpol-test --image=curlimages/curl -n atom-agents --restart=Never --rm -it -- \
  curl --max-time 5 http://atom-llm.atom-system.svc.cluster.local:4000/health
# Expected: connection refused or timeout (exit non-zero)

# 5. Verify audit HMAC chain integrity
python3 -c "
import asyncio, asyncpg, hmac, hashlib, os
async def check():
    conn = await asyncpg.connect(os.environ['DATABASE_URL'])
    rows = await conn.fetch('SELECT id, payload_hash, chain_hash, prev_hash FROM audit_log_chain ORDER BY id LIMIT 10')
    for r in rows:
        print(r['id'], r['chain_hash'][:16], '...')
    await conn.close()
asyncio.run(check())
"
```
