# SESSION-00 — Monorepo Setup

**Prerequisites:** Git, Go 1.22+, Python 3.11+, Node.js 20+, Docker, kind  
**Goal:** Clone all upstream forks into the monorepo, set up the Python workspace, and verify the full skeleton is correct.  
**Estimated time:** 0.5 days

---

## Context

The monorepo skeleton already exists (you are reading this from it). It contains:
- `gate/` and `atom-cli/` — Go components written from scratch (skeleton stubs present)
- `policies/` — OPA Rego policies (base policies and unit tests present)
- `infra/`, `migrations/`, `decisions/`, `sessions/`, `docs/` — fully populated
- `Makefile`, `docker-compose.dev.yml`, `.env.example`, `go.work`, etc. — present

**What is NOT yet present:** the five forked Python components. They must be cloned from
upstream in this session:

| Directory | Upstream |
|---|---|
| `atom-llm/` | https://github.com/BerriAI/litellm |
| `atom-sdk/` | https://github.com/modelscope/agentscope |
| `atom-studio/` | https://github.com/modelscope/agentscope (studio subpackage) |
| `atom-runtime/` | https://github.com/modelscope/agentscope (runtime subpackage) |
| `atom-memory/` | https://github.com/modelscope/agentscope (memory/reme subpackage) |

These are **not** git submodules. They live as plain subdirectories in this repo (ADR-001).
Once cloned and committed, upstream changes are merged manually using `diff` — the workflow
is documented in each component's `UPSTREAM_DIFF.md`.

---

## Tasks

### 1. Clone upstream forks

```bash
bash scripts/clone-upstreams.sh
```

This script:
- Clones each upstream with `--depth=1`
- Removes the upstream `.git` directory (detaches from upstream)
- Creates `UPSTREAM_DIFF.md` in each component
- Runs `git add` + `git commit` for the snapshot

**Before running:** check if agentscope has split studio/runtime/memory into separate repos
since this doc was written. Adjust URLs in `scripts/clone-upstreams.sh` if so.

---

### 2. Set up Python workspace

Create `pyproject.toml` at the repo root using `uv` workspaces:

```toml
# pyproject.toml
[tool.uv.workspace]
members = ["atom-llm", "atom-sdk", "atom-memory", "atom-runtime", "atom-studio"]
```

```bash
uv sync
```

This makes all five Python components importable in a shared virtual environment,
useful for running cross-component integration tests.

---

### 3. Verify Go workspace

`go.work` is already present. Run:

```bash
go work sync
cd gate && go vet ./...
cd ../atom-cli && go vet ./...
```

Both should exit 0. If `go.sum` is missing, run `go mod tidy` inside each module.

---

### 4. Copy .env.example to .env and fill in secrets

```bash
cp .env.example .env
# Generate secrets
echo "PLATFORM_HMAC_SECRET=$(openssl rand -hex 32)" >> .env
echo "ATOM_ENCRYPTION_KEY=$(openssl rand -hex 32)"  >> .env
```

---

### 5. Generate JWT key pair

```bash
make generate-keys
# Keys appear in .keys/ (gitignored)
# Update .env:
# JWT_PUBLIC_KEY_PATH=./.keys/jwt_public.pem
# JWT_PRIVATE_KEY_PATH=./.keys/jwt_private.pem
```

---

### 6. Start dev stack

```bash
make dev-up
```

At this point `atom-llm` uses the upstream LiteLLM published image and `atom-studio`
uses a placeholder. Both will be replaced with local builds in SESSION-05 and SESSION-07
respectively. The other services (Postgres, Redis, MinIO, Redpanda, OPA, Grafana) start fully.

---

### 7. Install pre-commit hooks

```bash
pre-commit install --install-hooks
```

---

### 8. Run smoke test

```bash
make migrate-up
make policy-test
make lint-go
docker ps | grep atom
# All containers should show "healthy" or "Up"
```

---

## Technologies

| Technology | Rationale |
|---|---|
| `scripts/clone-upstreams.sh` | Reproducible one-command setup; documents upstream URLs explicitly |
| `uv` workspace | Fast Python environment management across 5 components |
| `go.work` | Links `gate/` and `atom-cli/` for cross-module local development |
| Plain subdirectory (not submodule) | ADR-001: simpler DX, single repo audit trail |

---

## Acceptance Criteria

- [ ] `ls atom-llm/ atom-sdk/ atom-runtime/ atom-memory/ atom-studio/` — all exist with upstream content
- [ ] `git log --oneline | head -3` shows the upstream snapshot commit
- [ ] `go work sync` exits 0
- [ ] `go vet ./...` in `gate/` exits 0
- [ ] `make policy-test` — all 7 Rego tests pass
- [ ] `make dev-up` — `docker ps` shows all infra services healthy
- [ ] `make migrate-up` — all 7 migrations applied (after SESSION-02 creates them)
- [ ] `.env` exists with real secrets (not the `changeme` defaults)
- [ ] `.keys/jwt_private.pem` and `.keys/jwt_public.pem` exist

---

## Expected Outcome

A fully initialised monorepo with all upstream code present, Go tooling verified,
Python workspace wired, dev stack booted, and policies passing.

---

## Claude Code Starter Prompt

```
You are starting SESSION-00 of ATOM — monorepo setup.

The skeleton repo already exists. Your tasks:

1. Run: bash scripts/clone-upstreams.sh
   This clones atom-llm (LiteLLM), atom-sdk, atom-studio, atom-runtime, atom-memory
   (all agentscope variants) into the monorepo as plain subdirectories.
   If any URL is 404, check the current repo name on GitHub and update the script.

2. Create pyproject.toml at repo root for uv workspace:
   members: ["atom-llm", "atom-sdk", "atom-memory", "atom-runtime", "atom-studio"]
   Run: uv sync

3. Run: go work sync
   Then in gate/ and atom-cli/: go mod tidy

4. Copy .env.example to .env. Generate and set:
   PLATFORM_HMAC_SECRET=$(openssl rand -hex 32)
   ATOM_ENCRYPTION_KEY=$(openssl rand -hex 32)

5. Run: make generate-keys
   Update .env with the generated key paths.

6. Run: make dev-up
   Verify all docker containers are healthy.

7. Run: pre-commit install --install-hooks

8. Run: make policy-test — verify all 7 Rego tests pass.

9. Run: make lint-go — verify go vet passes on gate/ and atom-cli/.

Do NOT modify any upstream cloned code yet. That begins in SESSION-05 (atom-llm)
and SESSION-06 (atom-sdk). Document anything surprising in UPSTREAM_DIFF.md.
```
