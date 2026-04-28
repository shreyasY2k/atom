# SESSION-10 — atom-cli

**Prerequisites:** SESSION-08 complete  
**Goal:** Build the atom-cli Go tool with create, validate, deploy, and logs commands.  
**Estimated time:** 1.5 days

---

## Tasks

1. **Project structure** (`atom-cli/`)
   ```
   cmd/atom/main.go
   internal/
     config/          — config file (~/.atom/config.yaml)
     auth/            — login, token storage (keychain or file)
     scaffold/        — agent project generation
     validate/        — config validation
     deploy/          — deployment submission
     logs/            — log streaming
   templates/
     agent/           — agent project template files
   ```

2. **`atom login`**
   ```
   atom login --studio https://atom.internal
   # Prompts for email + password
   # Stores access token in ~/.atom/config.yaml (or OS keychain)
   ```

3. **`atom create agent <token>`**
   - Accepts the raw agent JWT from atom-studio.
   - Calls `GET /api/agents/me` on studio with the agent token to fetch config.
   - Scaffolds a Python agent project from `templates/agent/`:
     ```
     my-agent/
       atom_agent.yaml      — agent config (domain_id, agent_id, model, tools, skills)
       agent.py             — entry point using atom-sdk
       requirements.txt     — atom-sdk + other deps
       .env                 — ATOM_AGENT_JWT=<token> ATOM_GATE_URL=<url>
       Dockerfile           — builds the agent container
       .gitignore
       README.md
     ```

4. **`atom validate`**
   - Reads `atom_agent.yaml` from CWD.
   - Validates: domain/agent IDs exist, selected tools/skills are available, JWT parses correctly.
   - Optionally calls `GET /atom/tools` on atom-llm via GATE to verify tool reachability.
   - Exit 0 = valid, exit 1 = invalid (with description).

5. **`atom deploy`**
   - Reads `atom_agent.yaml` from CWD.
   - Builds Docker image (or accepts `--image` flag).
   - Calls `POST /api/deployments/{agent_id}` on studio.
   - Polls for approval status, prints progress.
   - On approval: prints "Deployment approved. Agent will be live at /domain/{did}/agent/{aid}".
   - On rejection: prints rejection note and exits 1.

6. **`atom logs [--follow]`**
   - Calls `GET /api/agents/{id}/logs` on studio (WebSocket stream if `--follow`).
   - Prints formatted log lines to stdout.

7. **`atom status`**
   - Shows current agent status, last deployment, HITL queue depth.

8. **Go template** for `templates/agent/` — use `text/template` with `.atom_agent.yaml.tmpl` etc.

9. **Release** — `goreleaser` config for linux/darwin/windows amd64+arm64 binaries.

---

## Technologies

| Technology | Rationale |
|---|---|
| Cobra (github.com/spf13/cobra) | Standard Go CLI framework; auto-generated help |
| go-keyring | Store tokens in OS keychain (macOS/Linux/Windows) |
| text/template | Simple agent project scaffolding |
| goreleaser | Cross-platform binary release |

---

## Acceptance Criteria

- [ ] `atom login` stores token; subsequent commands use it automatically.
- [ ] `atom create agent <token>` generates a working scaffold in a new directory.
- [ ] `atom validate` exits 0 for a valid agent config, 1 for invalid.
- [ ] `atom deploy` submits to studio and polls for approval.
- [ ] `atom --help` shows clean, formatted help for all subcommands.
- [ ] Cross-compiles for linux/amd64 and darwin/arm64.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-10 of ATOM — the atom-cli Go tool.

Context:
- Module: github.com/your-org/atom/atom-cli
- Framework: github.com/spf13/cobra
- Studio API base: configurable via --studio flag or ~/.atom/config.yaml
- Platform: macOS/Linux/Windows, amd64+arm64

Commands to implement:
1. atom login --studio <url> — prompt email/password, store JWT in ~/.atom/config.yaml
2. atom create agent <token> — scaffold a Python agent project from embedded templates
3. atom validate — validate atom_agent.yaml in CWD against studio API
4. atom deploy [--image <image>] — submit deployment, poll for approval
5. atom logs [--follow] — tail agent logs from studio API
6. atom status — show agent status, deployment history, HITL queue depth

Templates (embed in binary via //go:embed):
- templates/agent/atom_agent.yaml.tmpl
- templates/agent/agent.py.tmpl
- templates/agent/requirements.txt.tmpl
- templates/agent/Dockerfile.tmpl
- templates/agent/.env.tmpl
- templates/agent/README.md.tmpl

Config file: ~/.atom/config.yaml with: studio_url, access_token, refresh_token

Write goreleaser.yaml for cross-platform release.
Ensure `go build ./...` and `go test ./...` pass.
```

---

