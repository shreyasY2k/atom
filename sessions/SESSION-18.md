## SESSION-18 — ATOM Studio: Tools, Skills & Agent Builder

### Goal
Three tightly related pieces delivered together:
1. **Populate the existing Tools & Skills pages** in atom-studio (currently empty)
2. **Build the Agent Builder UI** — intent → capabilities → one-click deploy
3. **Configure LLM providers** in atom-llm — Gemini primary, OpenAI + Anthropic available

---

### What the Builder Actually Generates

The atom-cli already scaffolds everything from SESSION-16:
`atom_agent.yaml`, `Dockerfile`, `.gitlab-ci.yml`, `requirements.txt`.

**The builder generates exactly one file: `agent.py`.**

`agent.py` is the only file whose content varies based on what the user wants.
Everything else is templated and already handled by `atom create agent`.

The builder calls `gemini-3.1-pro-preview` with:
- The user's intent (what the agent should do)
- The selected skills (SKILL.md content — see ATOM-SKILLS.md)
- The selected MCP tools (names + schemas from atom-llm)
- The ATOM SDK patterns (correct imports, AtomChatModel, use_tool, etc.)

And gets back a correct `agent.py` ready to build and deploy.

---

### Key Design Decision: LiteLLM IS the Tool & Model Layer

**The UI shows only what atom-llm (LiteLLM) already has configured.**
No BYO model fields. No custom API URL/key inputs. The rule is:

> If it is not in LiteLLM, it does not appear in the UI.

| What the user sees | Where it actually lives |
|---|---|
| Available LLM models | `model_list` in `atom-llm/config.dev.yaml` — fetched via `GET /models` |
| Available MCP tools | MCP servers registered in LiteLLM — fetched via `GET /mcp/tools` |
| agentscope skills | `atom-sdk/skills/` — seeded into DB at startup |
| A2A targets | Other deployed agents in same domain — queried from Postgres |

---

### Part 1 — Tools & Skills Registry Pages (existing UI, currently empty)

#### Skills — seed from `atom-sdk/skills/`

atom-studio-api scans `atom-sdk/skills/` at startup, parses YAML frontmatter
from each `SKILL.md`, and upserts into the `skills` table. Idempotent on every restart.

```python
# atom-studio/backend/atom_studio/services/skills.py
import os, yaml

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")

def seed_skills(db):
    for entry in os.scandir(SKILLS_DIR):
        if not entry.is_dir(): continue
        skill_md = os.path.join(entry.path, "SKILL.md")
        if not os.path.exists(skill_md): continue
        with open(skill_md) as f:
            raw = f.read()
        parts = raw.split("---")
        if len(parts) < 3: continue
        meta = yaml.safe_load(parts[1])
        db.execute("""
            INSERT INTO skills (name, description, dir, builtin)
            VALUES (:name, :description, :dir, true)
            ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
        """, {"name": meta["name"], "description": meta.get("description", ""), "dir": entry.name})
```

Bind mount in docker-compose:
```yaml
# docker-compose.dev.yml — atom-studio-api service
volumes:
  - ./atom-sdk/skills:/atom-sdk/skills:ro
```

#### Tools — live proxy to atom-llm

No DB. `GET /api/tools` proxies directly to atom-llm `GET /mcp/tools`.
Returns `[]` + `503` warning header if atom-llm is unreachable.

#### Frontend (existing Tools & Skills page — just wire up the data)

```
Tools & Skills
├── Skills tab
│   ├── Search bar (client-side filter)
│   └── Card: name + description from SKILL.md frontmatter
│       [ View SKILL.md ] → side drawer, full markdown
└── Tools tab
    ├── Search bar
    └── Card: name + description from atom-llm
        [ View schema ] → side drawer, JSON input schema
```

---

### Part 2 — agentscope Skills as Codegen Context

**Skills are instruction documents fed to `gemini-3.1-pro-preview` so it generates
correct atom-sdk code. They are not injected into the deployed agent at runtime.**

ATOM ships 7 skills in `atom-sdk/skills/` (see `ATOM-SKILLS.md` for exact content):

| Skill | What it teaches the code generator |
|---|---|
| `atom-react-agent` | Correct `ReActAgent` + `AtomChatModel` constructor, import paths |
| `atom-gate-calls` | Always use `use_tool()`, never direct HTTP, error handling |
| `atom-hitl` | `request_human_decision()` usage, when to trigger, timeout handling |
| `atom-memory` | `MemoryManager` construction, `remember()` / `recall()` patterns |
| `atom-a2a` | `a2a_call()` usage, GATE routing, never direct pod-to-pod |
| `atom-multi-agent` | `MsgHub`, `sequential_pipeline` for in-pod orchestration |
| `atom-audit` | Never suppress exceptions, logging rules, retry limits |

When the builder generates `agent.py`, it feeds the relevant SKILL.md content
as context to `gemini-3.1-pro-preview` alongside the user's intent and tool schemas.
The LLM produces correct, ATOM-compliant code because the skills define exactly
what patterns to use and what never to generate.

**`atom-react-agent` + `atom-gate-calls` + `atom-audit` are always included.**
The rest are added based on what the user selected in the builder.

---

### Part 3 — Agent Builder UI

#### UI Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  ATOM Studio  →  Agents  →  + New Agent                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Step 1: Intent                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ What should this agent do?                               │  │
│  │ "Monitor credit applications, flag high-risk ones        │  │
│  │  and escalate to a human reviewer"                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│  [ Analyse Intent → ]  (gemini-3.1-pro-preview, server-side)   │
│                                                                 │
│  Step 2: Suggested Capabilities  (AI-generated, user editable) │
│                                                                 │
│  🤖 LLM Model  (live from GET /models on atom-llm)             │
│  ● gemini-2.5-flash  ○ gemini-3.1-pro-preview  ○ gpt-4o       │
│                                                                 │
│  🔧 MCP Tools  (live from GET /mcp/tools on atom-llm)          │
│  ✓ risk-score-api   ✓ notify-slack   + Add                     │
│                                                                 │
│  🧠 Skills  (from GET /api/skills — atom-sdk/skills/)          │
│  ✓ atom-hitl   ✓ atom-memory   (atom-react-agent always on)    │
│                                                                 │
│  🔗 A2A  (deployed agents in same domain — shown if ≥2 exist)  │
│  💡 KYC-Agent suggested — all A2A via GATE only                │
│                                                                 │
│  Step 3: Build & Deploy                                         │
│  ● GitLab (private)  ○ Local Docker                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ✅ Guardrails always active  |  📋 Audit always on       │  │
│  │  Agent ID + Domain ID + JWT provisioned automatically     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  [ ← Back ]                     [ 🚀 Approve + Deploy ]        │
└─────────────────────────────────────────────────────────────────┘
```

#### agent.py generation prompt (server-side, atom-studio-api)

```python
# atom-studio/backend/atom_studio/services/builder.py

ALWAYS_INCLUDED_SKILLS = ["atom-react-agent", "atom-gate-calls", "atom-audit"]

def build_agent_py_prompt(intent, model_name, tools, skills, a2a_targets):
    # Load SKILL.md content for each selected skill
    skill_context = ""
    all_skills = ALWAYS_INCLUDED_SKILLS + [s for s in skills if s not in ALWAYS_INCLUDED_SKILLS]
    for skill_name in all_skills:
        skill_path = f"{SKILLS_DIR}/{skill_name}/SKILL.md"
        with open(skill_path) as f:
            skill_context += f"

---
{f.read()}"

    tool_schemas = "
".join(f"- {t['name']}: {t['description']}" for t in tools)
    a2a_list = "
".join(f"- {a['name']}: {a['agent_id']}" for a in a2a_targets)

    return f"""
You are generating agent.py for an ATOM agent.
Follow ALL instructions in the skill documents below exactly.

## Agent intent
{intent}

## Model to use
{model_name}

## MCP Tools available (call via use_tool())
{tool_schemas}

## A2A targets (call via a2a_call())
{a2a_list}

## ATOM SDK Skills (FOLLOW THESE EXACTLY)
{skill_context}

Generate a complete, runnable agent.py.
Use only atom-sdk imports as specified in atom-react-agent skill.
Every tool call via use_tool(). Every A2A call via a2a_call().
Include HITL where appropriate for the intent.
Include memory recall before LLM calls if atom-memory is selected.
Output only the Python file content, no explanation.
"""
```

#### Models used for Studio AI

```python
# atom-studio/backend/atom_studio/services/ai.py
STUDIO_INTENT_MODEL  = "gemini-2.5-flash"         # intent parsing, capability suggestions
STUDIO_CODEGEN_MODEL = "gemini-3.1-pro-preview"   # agent.py generation
```

---

### Part 4 — One-Click Provisioning Sequence

When the user clicks **Approve + Deploy**:

```
POST /api/agents/build-and-deploy
  body: { intent, model, mcp_tools[], skills[], a2a_targets[], ci_provider }

  1. INSERT agents { status: provisioning }
  2. Provision LiteLLM virtual key (allowed_models: [chosen model])
  3. Register MCP tool permission guardrail on LiteLLM (scoped to virtual key)
  4. Sign agent JWT, store hash in agent_tokens
  5. INSERT agent_tools, agent_skills, agent_policies
  6. Call gemini-3.1-pro-preview with build_agent_py_prompt() → agent.py content
  7. atom-cli create agent flow: write agent.py to scaffolded project
     (atom_agent.yaml, Dockerfile, .gitlab-ci.yml already templated by CLI)
  8. Push to GitLab + trigger CI pipeline (SESSION-16 logic)
  9. INSERT deployments { status: building }
  10. Pipeline success → INSERT hitl_workflows (DEPLOYMENT_APPROVAL)
  11. Admin approves → atom-runtime creates k8s Deployment
  12. WebSocket: DEPLOY_COMPLETE → user can now chat with agent in Studio
```

---

### Part 5 — A2A Call Flow (GATE-mediated, always)

```
Calling Agent Pod
  │  a2a_call(target_agent_id, payload)
  │  → POST {GATE}/domain/{did}/agent/{aid}/a2a/{target_id}
  │  Authorization: Bearer {caller-agent-jwt}
  ▼
GATE
  ├─ RS256 verify caller JWT
  ├─ OPA: is caller allowed to call target?
  ├─ Rate limit
  ├─ Audit chain: A2A_CALL { caller, target, timestamp }
  └─ Resolve target pod from Postgres/Redis
  ▼
Target Agent Pod  (receives X-ATOM-Caller-Agent-ID header)
  ▼
GATE (response — audit appended)
  ▼
Calling Agent Pod
```

- LiteLLM `/a2a/` endpoint is **not used** — GATE handles it
- Agent pods never know each other's k8s addresses
- A2A targets must be declared in `atom_agent.yaml` and registered in Postgres

---

### Part 6 — LiteLLM Config (atom-llm)

```yaml
# atom-llm/config.dev.yaml
model_list:
  - model_name: gemini-3.1-pro-preview
    litellm_params:
      model: gemini/gemini-3.1-pro-preview
      api_key: os.environ/GEMINI_API_KEY

  - model_name: gemini-2.5-flash
    litellm_params:
      model: gemini/gemini-2.5-flash
      api_key: os.environ/GEMINI_API_KEY

  - model_name: gemini-2.0-flash
    litellm_params:
      model: gemini/gemini-2.0-flash
      api_key: os.environ/GEMINI_API_KEY

  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/OPENAI_API_KEY

  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/OPENAI_API_KEY

  - model_name: claude-sonnet-4
    litellm_params:
      model: anthropic/claude-sonnet-4-20250514
      api_key: os.environ/ANTHROPIC_API_KEY

  - model_name: claude-haiku-4
    litellm_params:
      model: anthropic/claude-haiku-4-5-20251001
      api_key: os.environ/ANTHROPIC_API_KEY
```

> New model = one block here + `make restart-llm`. Appears in Builder automatically.
> `GET /models` skips models whose API key env var is not set.

---

### Part 7 — CLI Parity

`atom build` does everything the UI does — generates `agent.py` via the same
`gemini-3.1-pro-preview` call, writes it into the scaffolded project.
Default is local-only (no deploy). `--deploy` triggers the full GitLab CI + approval flow.

```
$ atom build

? What should this agent do?
> Monitor credit applications and escalate high-risk ones

⠋ Analysing intent...
⠋ Generating agent.py...

✓ Generated agent.py
✓ Scaffolded at ./credit-monitor-agent/
  agent.py            ← generated by gemini-3.1-pro-preview
  atom_agent.yaml     ← templated by atom-cli (agent_id, domain_id, model, tools)
  Dockerfile          ← templated by atom-cli (FROM atom-sdk base image)
  .gitlab-ci.yml      ← templated by atom-cli
  requirements.txt    ← templated by atom-cli

Run atom deploy when ready.
```

```
atom build [--intent "..."] [--output ./dir] [--deploy]
atom skills list        # list skills from atom-sdk/skills/
atom skills show <name> # print full SKILL.md
atom tools list         # list MCP tools from atom-llm
atom tools show <name>  # show tool input schema
```

---

### Acceptance Criteria

**Tools & Skills pages:**
- [ ] Skills page shows all skills from `atom-sdk/skills/` — name + description
- [ ] Skills seed is idempotent on restart
- [ ] `atom-sdk/skills/` bind-mounted in dev and k8s
- [ ] Tools page fetches live from atom-llm `GET /mcp/tools`
- [ ] Tools page shows graceful "unavailable" state if atom-llm unreachable
- [ ] Search works on both tabs
- [ ] SKILL.md drawer and tool schema drawer work

**ATOM skill library:**
- [ ] All 7 SKILL.md files committed to `atom-sdk/skills/` with content from ATOM-SKILLS.md
- [ ] `atom-react-agent`, `atom-gate-calls`, `atom-audit` always included in codegen prompt

**Agent Builder UI:**
- [ ] Model picker live from `GET /models` — no hardcoded list
- [ ] MCP tools live from `GET /mcp/tools`
- [ ] Skills list from `GET /api/skills`
- [ ] A2A suggestion shown when ≥2 deployed agents in domain
- [ ] No BYO model field anywhere
- [ ] Approve + Deploy generates `agent.py`, triggers CI, agent is chatworthy at the end

**LiteLLM config:**
- [ ] All 7 models work with real API key in `.env`
- [ ] `GET /models` omits models whose API key env var is unset
- [ ] Intent analysis uses `gemini-2.5-flash`, codegen uses `gemini-3.1-pro-preview`

**CLI parity:**
- [ ] `atom build` generates `agent.py` only — all other files already templated
- [ ] `atom build --deploy` triggers full GitLab CI + approval flow
- [ ] `atom skills list/show` and `atom tools list/show` work

---

### Files to Create / Modify

```
atom-sdk/
  skills/
    atom-react-agent/SKILL.md     ← content from ATOM-SKILLS.md
    atom-gate-calls/SKILL.md      ← content from ATOM-SKILLS.md
    atom-hitl/SKILL.md            ← content from ATOM-SKILLS.md
    atom-memory/SKILL.md          ← content from ATOM-SKILLS.md
    atom-a2a/SKILL.md             ← content from ATOM-SKILLS.md
    atom-multi-agent/SKILL.md     ← content from ATOM-SKILLS.md
    atom-audit/SKILL.md           ← content from ATOM-SKILLS.md

atom-llm/
  config.dev.yaml                 ← add all 7 model entries

atom-studio/backend/
  atom_studio/services/skills.py  ← seed_skills() called on startup
  atom_studio/services/ai.py      ← STUDIO_INTENT_MODEL + STUDIO_CODEGEN_MODEL
  atom_studio/services/builder.py ← build_agent_py_prompt() + call gemini-3.1-pro-preview
  atom_studio/routes/skills.py    ← GET /api/skills, GET /api/skills/:name/content
  atom_studio/routes/tools.py     ← GET /api/tools, GET /api/tools/:name/schema
  atom_studio/routes/builder.py   ← GET /api/builder/models, /api/builder/a2a-agents
  atom_studio/routes/agents.py    ← POST /api/agents/build-and-deploy

atom-studio/frontend/
  src/pages/ToolsSkills.tsx       ← wire up existing empty page
  src/components/SkillCard.tsx
  src/components/ToolCard.tsx
  src/pages/AgentBuilder.tsx      ← 3-step builder
  src/components/ModelPicker.tsx
  src/components/CapabilityPanel.tsx

atom-cli/
  cmd/atom/build.go               ← atom build (generates agent.py only)
  cmd/atom/skills.go              ← atom skills list/show
  cmd/atom/tools.go               ← atom tools list/show
  internal/builder/prompt.go      ← build_agent_py_prompt equivalent in Go
  internal/builder/codegen.go     ← call gemini-3.1-pro-preview, write agent.py

docker-compose.dev.yml            ← atom-sdk/skills bind mount
infra/helm/atom-studio-values.yaml← skills volume for k8s
```
