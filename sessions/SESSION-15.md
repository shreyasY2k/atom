# SESSION-15 — E2E Testing + Hardening

**Prerequisites:** All prior sessions complete
**Goal:** End-to-end test suite, security hardening, performance baseline, and operational documentation.
**Estimated time:** 1.5 days

---

## Tasks

1. **E2E test scenario** (`tests/e2e/test_full_flow.py`)
   Full happy-path test:
   ```
   1. Create user + domain via studio API
   2. Create agent via studio (returns JWT)
   3. scaffold project: atom create (interactive — use expect/pexpect to drive the wizard)
      OR: in E2E context, skip atom create and use a pre-scaffolded fixture project
      that has ATOM_MODE=prod + ATOM_AGENT_JWT set from the token issued in step 2
   4. atom validate → exit 0
   5. Submit deployment: atom deploy
   6. Approve in studio HITL
   7. Wait for pod ready (kubectl wait)
   8. Send request: POST /domain/{did}/agent/{aid}/echo
   9. Verify response 200 + correct body
   10. Verify audit_log_chain has the request entry
   11. Verify atom.audit Kafka topic received the event
   12. Revoke agent token via studio API
   13. Verify next request returns 401
   ```

2. **Negative tests** (`tests/e2e/test_security.py`)
   - Expired JWT → 401.
   - Wrong domain in path → 403.
   - Revoked token → 401.
   - Tool not in agent's list → 403.
   - Direct call to atom-llm (bypassing GATE) → rejected by NetworkPolicy.
   - Rate limit: 200 req/s → some 429s.
   - HITL timeout → agent receives TimeoutError.

3. **Load test** (`tests/load/gate_load_test.js` using k6)
   - 50 virtual users, 60 second duration.
   - Target: p95 latency < 50ms, p99 < 100ms, error rate < 0.1%.
   - Report saved to `tests/load/results/`.

4. **Security hardening checklist** (`docs/SECURITY.md`):
   - [ ] All secrets in k8s Secrets (not ConfigMaps).
   - [ ] All Secrets sourced from env vars in pods (not mounted files for JWT keys).
   - [ ] GATE runs as non-root user in distroless container.
   - [ ] All pods have `runAsNonRoot: true`, `readOnlyRootFilesystem: true`.
   - [ ] NetworkPolicies validated: only GATE can reach atom-llm.
   - [ ] JWT private key stored in k8s Secret; GATE uses public key only.
   - [ ] HMAC secret rotated after first deployment.
   - [ ] Postgres connections use TLS.
   - [ ] MinIO bucket ACLs: no public access.
   - [ ] Kafka topics: authentication enabled (Redpanda SASL).

5. **Runbook** (`docs/RUNBOOK.md`)
   - How to rotate the JWT signing key pair.
   - How to rotate the HMAC audit secret.
   - How to add a new LLM provider to atom-llm.
   - How to add a new OPA policy.
   - How to scale GATE replicas.
   - How to restore from a MinIO audit archive.
   - How to validate the audit hash chain.
   - How to suspend an agent (revoke token + scale deployment to 0).

6. **API documentation**
   - GATE: OpenAPI spec at `gate/docs/openapi.yaml`.
   - atom-studio: FastAPI auto-generates `/docs` (Swagger UI).

7. **Developer guide** (`docs/DEVELOPER_GUIDE.md`)
   - How to build an agent with atom-sdk.
   - How to test locally against docker-compose.
   - How to add a new tool.
   - How to write a Rego policy and test it.

---

## Acceptance Criteria

- [ ] E2E happy path test passes end-to-end (`pytest tests/e2e/`).
- [ ] All negative tests pass (each security boundary tested).
- [ ] k6 load test: p95 < 50ms, error rate < 0.1% at 50 VUs.
- [ ] Security checklist 100% checked.
- [ ] RUNBOOK.md exists with all 8 procedures documented.
- [ ] `make test` runs all unit + integration tests and exits 0.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-15 of ATOM — E2E testing and security hardening.

Context: All ATOM components are running in the kind cluster. The full stack is deployed.

Tasks:
1. Write tests/e2e/test_full_flow.py using pytest + httpx:
   - Full happy path: create user → create domain → create agent → deploy → call → audit verify
   - Use subprocess to call atom-cli commands during the test
2. Write tests/e2e/test_security.py:
   - Test each security boundary (expired JWT, wrong domain, revoked token, rate limit, etc.)
3. Write tests/load/gate_load_test.js for k6:
   - 50 VUs, 60s, targeting /domain/{test-did}/agent/{test-aid}/echo
   - Thresholds: http_req_duration['p(95)'] < 50, errors < 0.001
4. Write docs/SECURITY.md with the full security checklist
5. Write docs/RUNBOOK.md with the 8 operational procedures
6. Write docs/DEVELOPER_GUIDE.md: building an agent, local testing, adding tools, Rego policies
7. Run make test and fix any failures
8. Run the k6 load test and save results to tests/load/results/

For E2E: the tests need a dedicated test domain/agent created in setUp and torn down in tearDown.
Ensure cleanup: delete test domain + agent after each test run.
```
