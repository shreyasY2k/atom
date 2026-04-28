# SESSION-11 — atom-runtime (Kubernetes Deployment)

**Prerequisites:** SESSION-09, SESSION-10 complete  
**Goal:** Implement atom-runtime to deploy approved agents to Kubernetes.  
**Estimated time:** 1.5 days

---

## Tasks

1. **Inspect agentscope-runtime** — understand existing deployment mechanisms.
   Document in `atom-runtime/UPSTREAM_DIFF.md`.

2. **Deployment webhook** (`atom-runtime/src/atom_runtime/deploy_webhook.py`)
   - FastAPI endpoint: `POST /runtime/deploy`
   - Called by atom-studio when a deployment is approved.
   - Payload: `{ agent_id, domain_id, image, memory_config_id }`.

3. **k8s manifest generation** (`atom-runtime/src/atom_runtime/manifest_builder.py`)
   For each agent deployment, generate:
   - `Deployment` in namespace `atom-agents`:
     ```yaml
     env:
       - name: ATOM_AGENT_JWT     # from k8s Secret
       - name: ATOM_GATE_URL      # GATE service URL
       - name: ATOM_AGENT_ID
       - name: ATOM_DOMAIN_ID
     resources: { requests: {cpu: 100m, memory: 256Mi}, limits: {cpu: 500m, memory: 512Mi} }
     ```
   - `Service` with name `agent-{agent_id}` — exposes port 8080.
   - `NetworkPolicy` — allow inbound from GATE only.

4. **Ingress rule** — GATE uses URL routing (no Ingress needed for per-agent routes since
   GATE handles the proxy internally). However, update `agents.cluster_service_name` column
   in Postgres to `agent-{agent_id}.atom-agents.svc.cluster.local`.

5. **Apply manifests** using the Kubernetes Python client (`kubernetes` package).

6. **Rollout monitoring** — poll pod readiness, update `deployments.status` in Postgres.
   On failure, set `status = 'failed'` and send failure notification to studio WebSocket.

7. **Rollback** — `POST /runtime/rollback/{deployment_id}` — scales down current Deployment
   and re-applies the previous deployment's manifest.

8. **Registration with studio** — atom-runtime starts up and registers its webhook URL
   with atom-studio via `POST /api/runtime/register`.

---

## Technologies

| Technology | Rationale |
|---|---|
| kubernetes Python client | Standard Python k8s client; supports all API resources |
| FastAPI (webhook server) | Consistent with other Python services |
| k8s Deployment + Service | Standard resource pair for a long-running agent service |

---

## Acceptance Criteria

- [ ] Approving a deployment in studio triggers atom-runtime webhook.
- [ ] `kubectl get pods -n atom-agents` shows the agent pod running.
- [ ] `kubectl get svc -n atom-agents` shows `agent-{id}` Service.
- [ ] `agents.cluster_service_name` updated in Postgres.
- [ ] GATE can proxy a request through to the running agent pod.
- [ ] Failed deployment → `deployments.status = 'failed'` in Postgres.
- [ ] Rollback via `POST /runtime/rollback/{id}` restores previous version.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-11 of ATOM — agent deployment to Kubernetes via atom-runtime.

Context:
- atom-runtime/ is forked from agentscope-runtime. Inspect and understand existing code.
- kind cluster is running; atom-agents namespace exists.
- atom-studio calls atom-runtime on deployment approval.
- kubernetes Python client is used to apply manifests.

Tasks:
1. Inspect agentscope-runtime and document existing deployment code in UPSTREAM_DIFF.md
2. Create atom_runtime/deploy_webhook.py — FastAPI endpoint POST /runtime/deploy
3. Create atom_runtime/manifest_builder.py — generates k8s Deployment + Service YAML for agent
   - Deployment: container image, ATOM_AGENT_JWT from Secret, ATOM_GATE_URL, ATOM_AGENT_ID
   - Service: ClusterIP, port 8080, name=agent-{agent_id}
   - NetworkPolicy: allow inbound only from gate pod selector
4. Apply manifests using kubernetes Python client
5. Poll pod readiness; update deployments.status in Postgres on success/failure
6. Update agents.cluster_service_name = "agent-{id}.atom-agents.svc.cluster.local"
7. POST /runtime/rollback/{deployment_id} — restore previous manifest
8. On startup: register webhook URL with studio via POST /api/runtime/register

After implementing, trigger a test deployment via atom-cli and verify the pod runs.
```

---

