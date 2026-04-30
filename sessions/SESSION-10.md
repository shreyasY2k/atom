# SESSION-10 — atom-cli

**Prerequisites:** SESSION-08 complete (agent provisioning working, tokens issuable)
**Goal:** Build the atom-cli Go tool — an interactive scaffolding wizard (`atom create`),
local dev loop (`atom build`, `atom run`), and production deployment pipeline (`atom deploy`
with security scanning).
**Estimated time:** 2 days

---

## Context

### Two distinct developer workflows

**Dev mode** — `atom create` + `atom run`
The developer scaffolds a ReAct agent project locally using `atom create` (no Studio visit,
no token, no network calls). The generated project calls LiteLLM directly with their own API
key. They iterate freely using `atom build` and `atom run`.

**Prod mode** — Studio provisioning + `atom deploy`
When the agent is ready for production, the developer creates a domain and agent in
atom-studio (SESSION-08 wizard), copies the one-time token, sets `ATOM_MODE=prod` and
`ATOM_AGENT_JWT=<token>` in their `.env`, then runs `atom deploy`. This triggers security
scanning and submits a deployment request to the HITL approval queue.

The two modes share the same generated project. Only the `.env` file changes between them.

### atom create is purely offline

`atom create` is a cookiecutter-style wizard. It asks questions and stamps out files.
It does NOT call Studio, GATE, or atom-llm. It has zero network dependencies.
This means it can be run immediately after SESSION-06 (atom-sdk complete), even before
Studio exists.

---

## Project Structure

```
atom-cli/
  cmd/
    atom/
      main.go              ← Cobra root command
    create/
      create.go            ← atom create subcommand + wizard
    build/
      build.go             ← atom build subcommand
    run/
      run.go               ← atom run subcommand
    deploy/
      deploy.go            ← atom deploy subcommand
    login/
      login.go             ← atom login subcommand
    validate/
      validate.go          ← atom validate subcommand
    logs/
      logs.go              ← atom logs subcommand
    status/
      status.go            ← atom status subcommand
  internal/
    config/
      config.go            ← ~/.atom/config.yaml read/write
    auth/
      auth.go              ← token storage (keychain or file)
    scaffold/
      scaffold.go          ← write project files from templates
    wizard/
      wizard.go            ← promptui interactive prompts helper
    docker/
      docker.go            ← docker build + run wrappers
    scan/
      secrets.go           ← gitleaks wrapper
      sast.go              ← bandit wrapper
      image.go             ← trivy wrapper
      opa.go               ← OPA policy check via GATE
      report.go            ← ScanReport struct + terminal renderer
  templates/
    agent/                 ← embedded Go templates (//go:embed)
      agent.py.tmpl
      tools.py.tmpl
      config.py.tmpl
      requirements.txt.tmpl
      Dockerfile.tmpl
      env.example.tmpl
      gitignore.tmpl
      README.md.tmpl
  go.mod
  go.sum
  goreleaser.yaml
```

---

## Commands

### `atom login --studio <url>`

Prompts for email + password interactively.
`POST /api/auth/login` → stores `access_token` + `studio_url` in `~/.atom/config.yaml`.

```
$ atom login --studio http://localhost:3001
Email: dev@example.com
Password: ••••••••
✓ Logged in to http://localhost:3001
```

---

### `atom create`  ← primary scaffolding command

Interactive cookiecutter-style wizard. **No arguments. No network calls. Fully offline.**

Uses `github.com/manifoldco/promptui` for styled interactive prompts.

#### Wizard steps

**Step 1 — Project name**
```
Project name: loan-screener
```
Validate: lowercase letters, numbers, hyphens only. No spaces.
Used as the directory name and default agent name.

**Step 2 — Description**
```
What does this agent do? (one line): Screens loan applications against risk policy
```
Optional. Enter to skip. Used as the sys_prompt preamble in generated `agent.py`.

**Step 3 — LLM provider**
```
LLM provider:
  ▸ OpenAI           (needs OPENAI_API_KEY)
    Anthropic         (needs ANTHROPIC_API_KEY)
    Google Gemini     (needs GEMINI_API_KEY)
    Local atom-llm    (needs LITELLM_API_KEY + LITELLM_BASE_URL)
```
Determines `LLM_BASE_URL` and key variable name in generated `.env.example`.

**Step 4 — Model name**
Pre-filled default based on provider:
- OpenAI → `gpt-4o`
- Anthropic → `claude-sonnet-4-20250514`
- Gemini → `gemini/gemini-2.5-flash`
- Local → `gemini-2.5-flash`

```
Model name [gpt-4o]:
```
Enter to accept default.

**Step 5 — Tools**
```
Select tools to include: (space to select, enter to confirm)
  ▸ [x] web_search    — search the web (stub, replace with real API)
    [ ] calculator    — evaluate math expressions
    [ ] file_reader   — read a local file by path
    [ ] http_get      — make an HTTP GET request
    [ ] memory_recall — recall facts from agent memory (stub)
```
At least one must be selected. `web_search` checked by default.

**Step 6 — Memory**
```
Include memory support? (y/N):
```
If yes: generates memory setup using agentscope's built-in memory in `agent.py`.

**Step 7 — HITL example**
```
Include HITL pause example? (y/N):
```
If yes: generates one `request_human_decision()` call in `agent.py`, with a comment
explaining it only activates in prod mode (requires Studio running).

**Step 8 — Summary + confirm**
```
───────────────────────────────────────
  Project:     loan-screener/
  Provider:    OpenAI
  Model:       gpt-4o
  Tools:       web_search, calculator
  Memory:      yes
  HITL:        no
───────────────────────────────────────
Create project? [Y/n]:
```

On confirm: write all project files, then print:

```
✓ Created ./loan-screener/

  Next steps:
    cd loan-screener/
    cp .env.example .env        ← fill in LLM_API_KEY
    pip install -r requirements.txt
    python agent.py             ← runs in dev mode (calls LLM directly)

  When ready for production:
    → Open atom-studio, create a domain + agent, copy the token
    → In .env: set ATOM_MODE=prod, ATOM_AGENT_JWT=<token>, ATOM_GATE_URL=<url>
    → atom deploy               ← scans + submits for approval
```

---

### `atom build [--tag <image:tag>]`

Run from an agent project directory (must contain `agent.py` and `Dockerfile`).

- Reads `name` from `atom_agent.yaml` if present; falls back to directory name.
- Default image tag: `atom/<name>:latest`
- Runs `docker build -t <tag> .` and streams output in real time.
- On success: writes `build.last_image: <tag>` into `atom_agent.yaml` (creates the file
  if it does not exist yet — it is optional in dev mode).
- On failure: exits 1.

```
$ atom build
[1/3] Building atom/loan-screener:latest...
Step 1/6 : FROM python:3.11-slim
...
✓ Built atom/loan-screener:latest
```

---

### `atom run [--port <port>]`

Run from an agent project directory.

- Requires `.env` to exist (print helpful error if missing, suggest `cp .env.example .env`).
- If no image has been built yet (`build.last_image` absent in `atom_agent.yaml`),
  automatically runs `atom build` first.
- Runs the container:
  ```bash
  docker run --rm \
    --env-file .env \
    -p <port>:8080 \
    <last_built_image>
  ```
- Default port: 8081.
- Streams container stdout/stderr to terminal.
- Ctrl-C sends SIGTERM to the container and waits for clean stop.

```
$ atom run
▶ Starting atom/loan-screener:latest on port 8081...
  (Ctrl-C to stop)

Starting loan-screener in DEV mode
Agent ready. Type 'exit' to quit.
```

---

### `atom deploy [--image <image:tag>] [--message "reason"]`

Production deployment path. Run from an agent project directory.
Requires `atom_agent.yaml` with `agent_id` and `domain_id` set (i.e. the agent has been
provisioned in Studio and the developer has set `ATOM_MODE=prod` in `.env`).

#### Sequence

```
[1/5] 🔍  Reading agent config...
[2/5] 🔐  Running secrets scan...
[3/5] 🛡   Running SAST scan...
[4/5] 📦  Scanning container image for CVEs...
[5/5] 📋  Checking OPA policy compliance...
```

Each step uses a spinner. Steps where the tool is not installed print
`⚠ skipped (gitleaks not found — install for stricter checks)` and continue.

**Step 2 — Secrets scan (gitleaks)**
```bash
gitleaks detect --source . --no-git --report-format json --report-path /tmp/gitleaks.json
```
Parse `/tmp/gitleaks.json`. Any finding → print findings table → **exit 1 (hard block)**.

**Step 3 — SAST scan (bandit)**
```bash
bandit -r . -f json -q -o /tmp/bandit.json
```
Parse `/tmp/bandit.json`. HIGH severity issues → **exit 1 (hard block)**.
MEDIUM issues → warn (included in report, does not block).

**Step 4 — Image CVE scan (trivy)**
```bash
trivy image --format json --quiet --output /tmp/trivy.json <image>
```
CRITICAL CVEs → **exit 1 (hard block)**.
HIGH CVEs → warn (included in report, does not block).

**Step 5 — OPA policy check**
```
POST http://<gate_url>/internal/policy/check
Body: atom_agent.yaml contents as JSON
```
If the endpoint returns 404 (not yet implemented): skip with warning.
Policy violations → **exit 1 (hard block)**.

#### Scan report

After all scans, print a styled summary table:

```
╔══════════════════════════════════════════════════════╗
║  ATOM Deployment Scan Report                         ║
║  Agent: loan-screener  │  2025-01-15 14:32 UTC       ║
╠══════════════════════════════════════════════════════╣
║  Secrets scan (gitleaks)   PASS   0 findings         ║
║  SAST (bandit)             WARN   2 medium            ║
║  Image CVEs (trivy)        PASS   0 critical, 1 high ║
║  OPA policy                PASS                      ║
╠══════════════════════════════════════════════════════╣
║  Overall: ✓ PASS — proceeding to deployment          ║
╚══════════════════════════════════════════════════════╝
```

If overall is FAIL, print the blocker reason and exit 1 before submitting anything.

#### Submission

If scan passes:
1. Build image if not already built (`build.last_image` absent).
2. Get git SHA: `git rev-parse HEAD` (use `"unknown"` if not in a git repo).
3. `POST /api/deployments/{agent_id}` with:
   ```json
   {
     "image": "atom/loan-screener:latest",
     "git_sha": "abc123",
     "message": "initial deployment",
     "scan_report": { ...full ScanReport struct as JSON... }
   }
   ```
   The `scan_report` is stored in `deployments.manifest_json` and shown to the approver
   in the Studio HITL queue before they decide to approve or reject.

4. Poll for approval:
   ```
   ⏳ Awaiting approval in atom-studio HITL queue...  (elapsed: 0:02:14)
   ```
   Every 5 seconds: `GET /api/deployments/{agent_id}` — check latest deployment status.
   On `approved`: print `✓ Deployment approved. Agent going live.`
   On `rejected`: print rejection note from studio. Exit 1.
   Timeout after 24h.

5. Ctrl-C during polling cancels the poll (does NOT cancel the deployment in Studio):
   ```
   Deployment submitted (ID: abc-123). Use `atom status` to check progress.
   ```

---

### `atom validate`

Run from agent project directory. Reads `atom_agent.yaml`.

- In dev mode (`ATOM_MODE=dev` or no `atom_agent.yaml`): validate file syntax only.
- In prod mode: verify domain/agent IDs exist against Studio API, JWT parses correctly,
  tools/skills are available.
- Exit 0 = valid, exit 1 = invalid (with description).

---

### `atom logs [--follow] [--since 1h]`

Reads `agent_id` from `atom_agent.yaml` in CWD.
`GET /api/agents/{id}/logs` — WebSocket stream if `--follow`.
Prints formatted log lines: `timestamp | level | message`.

---

### `atom status`

Reads `atom_agent.yaml` from CWD.
Prints: agent name, status, last deployment, HITL queue depth.

---

## Generated File Contents

### `config.py`

```python
"""
Agent configuration — switches between dev and prod mode via ATOM_MODE env var.

ATOM_MODE=dev  → calls LLM provider directly using your API key.
                 No GATE, no domain, no agent token required.
                 Set LLM_API_KEY and LLM_BASE_URL in .env.

ATOM_MODE=prod → routes all LLM calls through GATE using AtomChatWrapper.
                 Requires: domain + agent provisioned in atom-studio,
                           ATOM_AGENT_JWT set to your one-time agent token.
"""
import os

MODE = os.getenv("ATOM_MODE", "dev")


def get_model_config() -> dict:
    if MODE == "prod":
        return {
            "model_type":   "atom",
            "config_name":  "atom-default",
            "model_name":   os.environ["ATOM_MODEL_NAME"],
        }
    else:
        return {
            "model_type":   "openai_chat",
            "config_name":  "dev-model",
            "model_name":   os.environ["MODEL_NAME"],
            "api_key":      os.environ["LLM_API_KEY"],
            "client_args":  {
                "base_url": os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1"),
            },
        }
```

### `tools.py` (example — web_search + calculator selected)

```python
"""
Tool implementations for <project-name>.

In dev mode these run locally as plain Python functions.
In prod mode, register each tool in atom-studio (Tools → New Tool)
and provision it to your agent. GATE will route calls to your tool endpoint.
"""
from agentscope.service import ServiceToolkit, ServiceResponse, ServiceExecStatus


def web_search(query: str) -> ServiceResponse:
    """Search the web for information about the given query."""
    # TODO: replace stub with a real search API (e.g. Brave, Serper, Tavily)
    print(f"[web_search] query={query!r}")
    return ServiceResponse(
        status=ServiceExecStatus.SUCCESS,
        content=f"Stub result for: {query}. Replace with a real search implementation.",
    )


def calculator(expression: str) -> ServiceResponse:
    """Evaluate a mathematical expression and return the numeric result."""
    try:
        result = eval(expression, {"__builtins__": {}})  # noqa: S307
        return ServiceResponse(status=ServiceExecStatus.SUCCESS, content=str(result))
    except Exception as exc:
        return ServiceResponse(status=ServiceExecStatus.ERROR, content=str(exc))


def build_toolkit() -> ServiceToolkit:
    toolkit = ServiceToolkit()
    toolkit.add(web_search)
    toolkit.add(calculator)
    return toolkit
```

### `agent.py`

```python
"""
<project-name> — ReAct Agent
<description>

Dev mode (default):
    python agent.py

Prod mode (after atom-studio provisioning):
    ATOM_MODE=prod python agent.py
"""
import os
from dotenv import load_dotenv

load_dotenv()

import agentscope
from agentscope.agents import ReActAgent
from agentscope.message import Msg
from config import get_model_config
from tools import build_toolkit


def main() -> None:
    mode = os.getenv("ATOM_MODE", "dev")
    print(f"Starting <project-name> in {mode.upper()} mode")

    agentscope.init(model_configs=[get_model_config()])

    toolkit = build_toolkit()

    agent = ReActAgent(
        name="<project-name>",
        model_config_name="atom-default" if mode == "prod" else "dev-model",
        service_toolkit=toolkit,
        sys_prompt=(
            "<description>  "
            "Think step by step. Use tools when you need external information. "
            "Always cite which tool you used and what it returned."
        ),
        max_iters=10,
    )

    print("Agent ready. Type 'exit' to quit.\n")
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("exit", "quit", "q"):
            break
        if not user_input:
            continue
        response = agent(Msg(name="user", content=user_input, role="user"))
        print(f"\nAgent: {response.content}\n")


if __name__ == "__main__":
    main()
```

### `.env.example` (OpenAI variant — provider selection controls content)

```bash
# ─── Mode ─────────────────────────────────────────────────────────────
# dev  → call LLM provider directly (no GATE or provisioning needed)
# prod → route through GATE (requires atom-studio domain + agent + token)
ATOM_MODE=dev

# ─── Dev mode ─────────────────────────────────────────────────────────
LLM_API_KEY=sk-...
LLM_BASE_URL=https://api.openai.com/v1
MODEL_NAME=gpt-4o

# ─── Prod mode (fill in after atom-studio provisioning) ───────────────
# ATOM_GATE_URL=http://localhost:8080
# ATOM_DOMAIN_ID=<domain-uuid>
# ATOM_AGENT_ID=<agent-uuid>
# ATOM_AGENT_JWT=<one-time-token-from-studio>
# ATOM_MODEL_NAME=gpt-4o
```

### `Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "agent.py"]
```

### `requirements.txt`

```
agentscope>=0.0.5
atom-sdk>=0.1.0
python-dotenv>=1.0.0
```

### `README.md`

```markdown
# <project-name>

<description>

Generated by `atom create`. Uses atom-sdk (agentscope) with a ReAct agent loop.

## Quickstart — dev mode (no infrastructure needed)

\```bash
cp .env.example .env      # fill in LLM_API_KEY
pip install -r requirements.txt
python agent.py
\```

## Switch to prod mode

1. Open atom-studio → create a domain → create an agent (7-step wizard)
2. Copy the one-time token shown after agent creation
3. In `.env`, update:
   \```
   ATOM_MODE=prod
   ATOM_GATE_URL=http://<your-gate>:8080
   ATOM_DOMAIN_ID=<domain-uuid>
   ATOM_AGENT_ID=<agent-uuid>
   ATOM_AGENT_JWT=<token>
   ATOM_MODEL_NAME=gpt-4o
   \```
4. Deploy:
   \```bash
   atom deploy --message "initial deployment"
   \```
   atom deploy will scan for secrets, run SAST, check image CVEs, verify OPA policy,
   then submit a deployment request to the atom-studio approval queue.

## Project layout

| File | Purpose |
|---|---|
| `agent.py` | ReAct agent entry point |
| `tools.py` | Tool implementations (replace stubs with real logic) |
| `config.py` | Dev/prod model config switching |
| `.env` | Environment variables (gitignored) |
```

---

## Studio API Change Required (SESSION-09 dependency)

`POST /api/deployments/{agent_id}` must accept a `scan_report` JSON field alongside
`image`, `git_sha`, and `message`. Store it in `deployments.manifest_json`.

In the atom-studio HITL queue decision drawer (SESSION-09), display the scan report
to the approver before they decide:

```
Scan Report
────────────────────────────────
Secrets (gitleaks)   ✓ PASS
SAST (bandit)        ⚠ 2 medium
Image CVEs (trivy)   ✓ PASS
OPA policy           ✓ PASS
Overall              ✓ PASS
────────────────────────────────
[View full report JSON ▼]
```

---

## Technologies

| Technology | Rationale |
|---|---|
| `github.com/spf13/cobra` | Standard Go CLI framework |
| `github.com/manifoldco/promptui` | Styled interactive prompts (select, input, confirm) |
| `github.com/charmbracelet/lipgloss` | Terminal table and box styling for scan report |
| `go-keyring` | OS keychain for token storage |
| `text/template` + `//go:embed` | Template rendering + binary embedding |
| `goreleaser` | Cross-platform binary release |

---

## Acceptance Criteria

- [ ] `atom create` runs with no flags and makes zero network calls
- [ ] Wizard accepts all 7 inputs and prints a summary before writing files
- [ ] Generated directory contains all 7 files
- [ ] `cd <project> && pip install -r requirements.txt && python agent.py` works
      in dev mode with a valid `LLM_API_KEY` (agent responds to "what is 2+2?")
- [ ] Setting `ATOM_MODE=prod` in `.env` switches `config.py` to use `AtomChatWrapper`
- [ ] Only selected tools appear in generated `tools.py`
- [ ] Provider selection populates `.env.example` with the correct `LLM_BASE_URL` and key name
- [ ] `atom build` runs `docker build`, streams output, writes `last_image` to `atom_agent.yaml`
- [ ] `atom run` starts the container with `--env-file .env` and streams logs
- [ ] `atom run` auto-calls `atom build` if no image has been built yet
- [ ] `atom deploy` runs all 4 scans (gracefully skipping any whose tool is not installed)
- [ ] `atom deploy` prints the styled scan report table
- [ ] `atom deploy` hard-blocks (exit 1) on: any secret found, any HIGH SAST finding, any CRITICAL CVE
- [ ] `atom deploy` attaches `scan_report` JSON to the studio deployment submission
- [ ] `atom logs --follow` streams logs via WebSocket
- [ ] `atom status` shows agent status + last deployment
- [ ] `go build ./...` and `go test ./...` pass
- [ ] Cross-compiles for linux/amd64, darwin/arm64, windows/amd64

---

## Claude Code Starter Prompt

```
You are implementing SESSION-10 of ATOM — the atom-cli Go tool.

Module: github.com/shreyasY2k/atom/atom-cli
Framework: github.com/spf13/cobra
Interactive prompts: github.com/manifoldco/promptui
Terminal styling: github.com/charmbracelet/lipgloss
Studio API base: configurable via --studio flag or ~/.atom/config.yaml
Platform: macOS / Linux / Windows, amd64 + arm64

IMPORTANT DESIGN DECISION:
`atom create` is a purely offline cookiecutter-style wizard.
It asks 7 questions, then writes a ReAct agent project to a local directory.
It makes ZERO network calls. No Studio token required.
This is intentional: developers use atom create to scaffold and iterate in dev mode
(direct LLM call with API key) before ever touching Studio or GATE.
The Studio token (ATOM_AGENT_JWT) is only needed for prod mode and is set manually
in .env by the developer after Studio provisioning.

Commands to implement:

1. atom login --studio <url>
   Prompt email + password → POST /api/auth/login → store JWT in ~/.atom/config.yaml

2. atom create  (no arguments)
   Interactive wizard — 7 steps — fully offline:
     Step 1: project name (lowercase, hyphens only)
     Step 2: description (optional)
     Step 3: LLM provider select (OpenAI / Anthropic / Gemini / Local atom-llm)
     Step 4: model name (pre-filled default per provider, editable)
     Step 5: tools multi-select (web_search checked by default)
     Step 6: include memory? y/N
     Step 7: include HITL example? y/N
     Summary + confirm → write project directory
   Scaffold files: agent.py, tools.py, config.py, requirements.txt,
                   Dockerfile, .env.example, .env (copy of .env.example), .gitignore, README.md
   Use //go:embed for all templates. Use text/template for rendering.
   Print next-steps instructions after scaffolding.

3. atom build [--tag <image:tag>]
   docker build -t <tag> . — stream output — write last_image to atom_agent.yaml

4. atom run [--port <port>]
   docker run --rm --env-file .env -p <port>:8080 <last_image>
   Auto-build if no image yet. Default port 8081. Stream logs. Ctrl-C stops cleanly.

5. atom deploy [--image <image>] [--message "reason"]
   a. Read atom_agent.yaml (must have agent_id + domain_id for prod mode)
   b. Run 4 scans with spinners (gitleaks, bandit, trivy, OPA check via GATE)
      Gracefully skip if tool not installed. Hard-block on: any secret, HIGH SAST, CRITICAL CVE.
   c. Print styled scan report table (lipgloss box)
   d. Build image if needed
   e. POST /api/deployments/{agent_id} with image + git_sha + message + scan_report JSON
   f. Poll for approval every 5s — show elapsed time
   g. Ctrl-C cancels poll but not the deployment

6. atom validate
   Read atom_agent.yaml — syntax check in dev mode, API verify in prod mode

7. atom logs [--follow]
   GET /api/agents/{id}/logs — WebSocket if --follow

8. atom status
   Read atom_agent.yaml → GET agent status from Studio

Templates — embed all in binary via //go:embed templates/agent/:
  agent.py.tmpl, tools.py.tmpl, config.py.tmpl, requirements.txt.tmpl,
  Dockerfile.tmpl, env.example.tmpl, gitignore.tmpl, README.md.tmpl

Template data struct:
  Name, Description, Provider, ProviderBaseURL, ProviderKeyVar,
  ModelName, Tools []ToolDef, IncludeMemory, IncludeHITL

Config file: ~/.atom/config.yaml — studio_url, access_token, refresh_token

Write goreleaser.yaml targeting linux/amd64, darwin/arm64, windows/amd64.
Ensure `go build ./...` and `go test ./...` pass.
Start with cmd/atom/main.go + cmd/create/ (the wizard), as that unblocks dev
workflow testing immediately. Then implement cmd/deploy/ with scan/.
```
