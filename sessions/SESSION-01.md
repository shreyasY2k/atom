# SESSION-01 — Infrastructure on kind

**Prerequisites:** SESSION-00 complete; kind, helm, kubectl installed  
**Goal:** Deploy all stateful infrastructure services to the kind cluster.  
**Estimated time:** 1 day

---

## Tasks

1. **Create kind cluster**
   ```bash
   kind create cluster --config infra/kind/cluster.yaml --name atom
   kubectl config use-context kind-atom
   ```

2. **Apply namespace manifests**
   ```bash
   kubectl apply -f infra/manifests/namespaces.yaml
   ```
   Namespaces: `atom-system` (GATE, studio, CLI backend), `atom-infra` (Postgres, Redis, MinIO,
   Kafka, OPA), `atom-agents` (agent pods).

3. **Install nginx-ingress controller**
   ```bash
   helm upgrade --install ingress-nginx ingress-nginx \
     --repo https://kubernetes.github.io/ingress-nginx \
     --namespace ingress-nginx --create-namespace \
     --values infra/helm/nginx-values.yaml
   ```

4. **Deploy PostgreSQL 16 with pgvector**  
   Use Bitnami chart. Custom values: enable pgvector via init script in ConfigMap.
   ```yaml
   # infra/helm/postgres-values.yaml
   image:
     repository: pgvector/pgvector
     tag: pg16
   auth:
     postgresPassword: ${POSTGRES_PASSWORD}
     database: atom
   primary:
     initdb:
       scripts:
         init.sql: |
           CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
           CREATE EXTENSION IF NOT EXISTS vector;
           CREATE EXTENSION IF NOT EXISTS pg_trgm;
   ```

5. **Deploy Redis 7**  
   Bitnami Redis chart, standalone mode. Auth enabled.

6. **Deploy MinIO**  
   MinIO Helm chart. Create bucket `atom-audit` on startup via init job.

7. **Deploy Redpanda (Kafka-compatible)**  
   Redpanda Helm chart. Create topics: `atom.audit`, `atom.llm`, `atom.agent.logs`,
   `atom.deployments` via post-install hook.

8. **Deploy OPA standalone**  
   `openpolicyagent/opa:latest-rootless` as a Deployment in `atom-infra`.
   Mount `policies/` bundle via ConfigMap for dev (bundle API in prod).
   Expose gRPC and HTTP ports internally.

9. **Create Kubernetes Secrets** for all credentials:
   ```bash
   kubectl create secret generic atom-credentials \
     --from-env-file=.env \
     -n atom-system
   ```

10. **Verify all services are healthy**
    ```bash
    kubectl get pods -n atom-infra
    # All should show Running/Ready
    ```

11. **Smoke-test connectivity**  
    Port-forward Postgres, run `psql` and verify extensions.  
    Port-forward Redis, run `redis-cli ping`.  
    Port-forward MinIO, open console UI.

12. **Document** all Helm values in `infra/helm/README.md`.

---

## Technologies

| Technology | Rationale |
|---|---|
| Helm 3 | Standard k8s package manager; all infra components have maintained charts |
| Bitnami charts | Battle-tested, well-documented, configurable for production patterns |
| pgvector/pgvector:pg16 | PostgreSQL 16 image with pgvector pre-installed |
| Redpanda Helm chart | Single binary Kafka-compatible; lighter than full Kafka for dev |
| nginx-ingress | Standard k8s ingress controller; port-maps cleanly to kind hostPorts |

---

## Acceptance Criteria

- [ ] `kubectl get pods -n atom-infra` — all pods in `Running` state.
- [ ] `psql -U postgres -c "\dx"` shows `uuid-ossp`, `vector`, `pg_trgm`.
- [ ] `redis-cli ping` returns `PONG`.
- [ ] MinIO console accessible at `http://localhost:9001`.
- [ ] Redpanda topics `atom.audit`, `atom.llm`, `atom.agent.logs`, `atom.deployments` exist.
- [ ] OPA `http://localhost:8181/v1/policies` returns 200.
- [ ] `make infra-down && make infra-up` — cluster recreates cleanly.

---

## Expected Outcome

A fully operational kind cluster with Postgres (pgvector), Redis, MinIO, Redpanda, and OPA
running in the `atom-infra` namespace, all accessible from within the cluster.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-01 of ATOM — deploying infrastructure to kind.

Context: SESSION-00 is complete. We have a kind cluster config at infra/kind/cluster.yaml.

Tasks:
1. Create kind cluster: `kind create cluster --config infra/kind/cluster.yaml --name atom`
2. Apply infra/manifests/namespaces.yaml (namespaces: atom-system, atom-infra, atom-agents)
3. Install nginx-ingress via helm
4. Write infra/helm/postgres-values.yaml using pgvector/pgvector:pg16 image, enable
   uuid-ossp and vector extensions via initdb scripts
5. Deploy Postgres via bitnami/postgresql chart with above values to atom-infra namespace
6. Deploy Redis via bitnami/redis (standalone) to atom-infra namespace
7. Deploy MinIO via minio/minio chart; create atom-audit bucket via init job
8. Deploy Redpanda via redpanda/redpanda chart; create the four topics via post-install hook
9. Deploy OPA as a Deployment with policies/base/ mounted as a ConfigMap
10. Create infra/scripts/smoke-test.sh that port-forwards and verifies all services

Write all Helm values files to infra/helm/. Write k8s manifests to infra/manifests/.
After all deployments, run the smoke-test script and confirm all services are healthy.
```

---

