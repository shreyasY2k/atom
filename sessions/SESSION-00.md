# SESSION-00 — Monorepo Setup

**Prerequisites:** Git, Go 1.22+, Python 3.11+, Node.js 20+, Docker, kind  
**Goal:** Create the ATOM monorepo skeleton with all upstream forks vendored, tooling configured, and a working `make dev-up`.  
**Estimated time:** 0.5 days

---

## Tasks

1. **Initialise git repo**  
   `git init atom && cd atom`  
   Set up conventional commits config (`.commitlintrc.yaml`), `.gitignore`.

2. **Clone upstream forks into subdirectories**
   ```bash
   git clone https://github.com/modelscope/agentscope           atom-sdk
   git clone https://github.com/modelscope/agentscope           atom-studio    # studio subdir
   git clone https://github.com/modelscope/agentscope-runtime   atom-runtime   # if separate
   git clone https://github.com/BerriAI/litellm                 atom-llm
   ```
   Commit each as an initial vendor snapshot with message `chore: vendor <upstream> as <component>`.

3. **Initialise Go workspace** for `gate/` and `atom-cli/`  
   ```
   gate/
     cmd/gate/main.go
     internal/{auth,policy,router,audit,proxy}/
     go.mod  (module github.com/your-org/atom/gate)
   atom-cli/
     cmd/atom/main.go
     internal/{config,auth,scaffold,deploy}/
     go.mod  (module github.com/your-org/atom/atom-cli)
   go.work  (links both modules)
   ```

4. **Python workspace** — create `pyproject.toml` (hatch or uv) at root referencing  
   `atom-llm`, `atom-sdk`, `atom-memory`, `atom-runtime` as workspace members.

5. **Create `infra/` skeleton**
   ```
   infra/
     kind/cluster.yaml
     helm/
       values-dev.yaml
       values-prod.yaml
     manifests/
       namespaces.yaml
   ```
   `namespaces.yaml` defines: `atom-system`, `atom-infra`, `atom-agents`.

6. **Create `policies/` skeleton**
   ```
   policies/
     base/
       agent_auth.rego
       domain_isolation.rego
       tool_access.rego
       PLACEHOLDER_bfsi_compliance.rego
     custom/
       .gitkeep
     tests/
       agent_auth_test.rego
   ```

7. **Root Makefile** with targets:
   - `make bootstrap` — installs tool versions (go, python, node, helm, kind, kubectl, opa cli)
   - `make infra-up` — creates kind cluster + deploys infra helm charts
   - `make infra-down` — tears down kind cluster
   - `make migrate-up` / `make migrate-down` — runs golang-migrate
   - `make dev-up` — starts all services via docker-compose
   - `make dev-down`
   - `make test` — runs all test suites
   - `make lint` — runs golangci-lint, ruff, eslint
   - `make gate-build` — builds GATE binary
   - `make cli-install` — builds and installs `atom` CLI
   - `make policy-test` — runs `opa test policies/`
   - `make policy-bundle` — compiles OPA bundle

8. **`docker-compose.dev.yml`** with services:
   - `postgres` (postgres:16 + pgvector)
   - `redis`
   - `minio`
   - `redpanda` (Kafka-compatible)
   - `opa` (openpolicyagent/opa:latest-rootless)
   - `gate` (built from `gate/Dockerfile`)
   - `atom-llm` (built from `atom-llm/Dockerfile`)
   - `atom-studio` (built from `atom-studio/Dockerfile`)

9. **`.env.example`** at root documenting all required environment variables.

10. **Pre-commit hooks** (`.pre-commit-config.yaml`):
    - `golangci-lint` on `gate/` and `atom-cli/`
    - `ruff` on Python components
    - `opa fmt` and `opa check` on `policies/`
    - `conventional-commits` linting on commit messages

---

## Technologies

| Technology | Rationale |
|---|---|
| Git subtree / copy | Simpler than submodules for upstream vendor; manual but explicit |
| Go workspace (`go.work`) | Links gate/ and atom-cli/ modules for local cross-module dev |
| `uv` or `hatch` | Fast Python workspace management; reproducible lockfiles |
| Makefile | Universal, no additional tooling needed; every developer knows make |
| docker-compose | Fast local iteration without k8s overhead |
| pre-commit | Catches issues before they reach CI; enforces consistency |

---

## Acceptance Criteria

- [ ] `make bootstrap` completes without error on a clean machine (Ubuntu 22+ or macOS 14+).
- [ ] `make dev-up` starts all 8 services; `docker ps` shows all healthy.
- [ ] `make policy-test` runs and passes the stub Rego test.
- [ ] `make lint` exits 0.
- [ ] `git log --oneline` shows at least one commit per upstream vendor.
- [ ] `go work sync` succeeds with no errors.

---

## Expected Outcome

A working monorepo with all components present, a Makefile-driven developer workflow, and a
docker-compose environment that boots Postgres, Redis, MinIO, Kafka, and OPA in one command.

---

## Claude Code Starter Prompt

```
You are helping implement SESSION-00 of the ATOM platform — a secure agentic framework for BFSI.

Your task: Set up the ATOM monorepo skeleton.

Context:
- Monorepo at ~/atom (create if not exists)
- Components: gate/ (Go), atom-cli/ (Go), atom-llm/ (Python, clone of LiteLLM),
  atom-sdk/ (Python, clone of agentscope), atom-studio/ (existing agentscope-studio stack),
  atom-memory/ (Python), atom-runtime/ (Python), policies/ (OPA Rego), infra/ (Helm/k8s)
- Local k8s: kind (already installed)

Steps to execute in order:
1. Clone agentscope into atom-sdk/ and atom-studio/ (agentscope-studio is a subdirectory)
2. Clone BerriAI/litellm into atom-llm/
3. Initialise gate/ as Go module github.com/your-org/atom/gate with directory skeleton
4. Initialise atom-cli/ as Go module with Cobra skeleton
5. Create go.work linking gate/ and atom-cli/
6. Create pyproject.toml using uv workspace for Python components
7. Create infra/kind/cluster.yaml for a 3-node kind cluster with port mappings
8. Create policies/ directory with stub Rego files
9. Create root Makefile with all targets described in SESSION-00
10. Create docker-compose.dev.yml with postgres+pgvector, redis, minio, redpanda, opa
11. Create .env.example with all required variables
12. Create .pre-commit-config.yaml

For the kind cluster config, expose:
- hostPort 80 → containerPort 80 (GATE)
- hostPort 3000 → containerPort 3000 (studio)
- hostPort 9001 → containerPort 9001 (MinIO console)
- hostPort 3001 → containerPort 3001 (Grafana)

After completing, run: make lint (should exit 0 even with empty stubs).
```

---

