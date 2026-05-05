# SESSION-18b — Conversational Agent Builder (Full End-to-End)

> Addendum to SESSION-18. Prerequisites: SESSION-16 (GitLab CI), SESSION-18
> (tools/skills pages, LiteLLM config, codegen). This session wires everything
> into a single panel where the user talks, ATOM reasons, and a live agent
> is the output — no terminal, no GitLab login, no kubectl.

---

## What This Session Delivers

One panel. User describes what they want. ATOM:
1. Asks clarifying questions via chat
2. Suggests tools, skills, model, A2A from live data
3. User confirms
4. ATOM creates the GitLab repo, sets permissions, generates all files, pushes
5. Triggers CI pipeline — image built and pushed to registry
6. Provisions agent identity (agent_id, domain_id, JWT, LiteLLM virtual key)
7. Deploys to atom-runtime on k8s
8. Returns a live chat link

User touches nothing outside this panel.

---

## The Panel Layout

Split panel — conversation on the left, live capability summary on the right.
Both are part of the same page at `/agents/new`.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ATOM Studio  →  Agents  →  + New Agent                                    │
├──────────────────────────────────────┬──────────────────────────────────────┤
│  💬  Builder                         │  📋  Agent Spec                      │
│                                      │                                      │
│  🤖 Hi! Tell me what kind of agent  │  Name    credit-risk-analyser        │
│     you need.                        │  Model   ──────────────────          │
│                                      │  Tools   ──────────────────          │
│  👤 I need a finance risk analyser  │  Skills  ──────────────────          │
│     agent                            │  HITL    ──────────────────          │
│                                      │  A2A     none                        │
│  🤖 What kind of risk?              │  Build   GitLab (private)            │
│     · Credit (loan applications)    │                                      │
│     · Market (portfolio, VaR)       │  ──────────────────────────────────  │
│     · Fraud (transaction anomaly)   │  🤖 LLM Model                        │
│     · Operational (compliance)      │  ● gemini-2.5-flash                  │
│                                      │  ○ gemini-3.1-pro-preview            │
│  👤 Credit risk — loan scoring      │  ○ gpt-4o                            │
│                                      │                                      │
│  🤖 Should it escalate high-risk    │  🔧 MCP Tools                        │
│     decisions to a human reviewer?  │  ✓ risk-score-api                    │
│                                      │  ✓ lookup-customer                   │
│  👤 Yes, escalate above score 80    │  ✓ notify-slack                      │
│                                      │                                      │
│  🤖 I have these tools available:   │  🧠 Skills                           │
│     · risk-score-api                │  ✓ atom-hitl                         │
│     · lookup-customer               │  ✓ atom-memory                       │
│     · notify-slack                  │  ✓ atom-gate-calls (always on)       │
│     Include all three?              │  ✓ atom-audit (always on)            │
│                                      │                                      │
│  👤 Yes all three                   │  🔗 A2A                              │
│                                      │  💡 KYC-Agent suggested              │
│  🤖 Which model?                    │                                      │
│     · gemini-2.5-flash              │  ──────────────────────────────────  │
│     · gemini-3.1-pro-preview        │  ✅ Guardrails always active         │
│     · gpt-4o                        │  📋 Audit always on                  │
│                                      │  🔐 Agent ID + JWT auto-provisioned  │
│  👤 gemini-2.5-flash                │                                      │
│                                      │  [ ✏️ Edit spec ]                    │
│  🤖 Review the spec on the right.  │                                      │
│     Ready to deploy?                │  [ 🚀 Build & Deploy ]               │
│                                      │                                      │
│  👤 Deploy it                        │                                      │
│                                      │                                      │
│  🤖 ✓ Provisioned agent identity   │                                      │
│     ✓ agent.py generated            │                                      │
│     ✓ GitLab repo created           │                                      │
│     ✓ Permissions configured        │                                      │
│     ✓ All files generated & pushed  │                                      │
│     ⠋ Building image (pipeline #42) │                                      │
│     ✓ Image built & pushed          │  ┌──────────────────────────────┐   │
│     ✓ Deployed to runtime           │  │ ✅ credit-risk-analyser       │   │
│     ✓ Agent is live!               │  │    is live                   │   │
│                                      │  │ [ 💬 Chat now → ]            │   │
│  [ 💬 Chat with this agent → ]      │  └──────────────────────────────┘   │
│  ─────────────────────────────────  │                                      │
│  Type a message...         [Send]   │                                      │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### Right panel behaviour
- Starts empty, updates live as each AI turn resolves a field
- Every row is editable inline — clicking opens a live picker
  (tools from `GET /mcp/tools`, skills from `GET /api/skills`, models from `GET /models`)
- Build & Deploy activates only when stage = confirming
- After deploy completes, shows AgentReadyCard with chat link

---

## Full Deploy Sequence

Everything ATOM does automatically after the user confirms:

```
User clicks Build & Deploy (or types "deploy it")
  │
  ▼
1. PROVISION AGENT IDENTITY
   INSERT agents { name, domain_id, status: provisioning }
   Provision LiteLLM virtual key (allowed_models: [chosen model])
   Register MCP tool permission guardrail scoped to virtual key
   Sign RS256 agent JWT → INSERT agent_tokens { token_hash }
   INSERT agent_tools, agent_skills, agent_policies
   → stream: "✓ Provisioned agent identity (ID: agent-uuid)"

2. GENERATE agent.py
   Call gemini-3.1-pro-preview with build_agent_py_prompt()
   (intent + tools + skills + SKILL.md context — from SESSION-18)
   → stream: "✓ agent.py generated"

3. CREATE GITLAB REPO
   GitLab API: POST /api/v4/projects
     name: <agent-name>
     namespace: ATOM_GITLAB_GROUP
     visibility: private
     initialize_with_readme: false
   Store repo URL + project_id in agents table
   → stream: "✓ GitLab repo created (gitlab.com/org/agent-name)"

4. SET REPO PERMISSIONS
   GitLab API: POST /api/v4/projects/:id/members
     Add ATOM_GITLAB_RUNNER_USER as Maintainer (access_level: 40)
   GitLab API: POST /api/v4/projects/:id/variables
     ATOM_BUILD=true
   → stream: "✓ Permissions configured"

5. GENERATE AND PUSH ALL FILES
   Generate all scaffold files (same templates as SESSION-16 atom-cli):
     agent.py            ← generated by gemini-3.1-pro-preview (step 2)
     atom_agent.yaml     ← agent_id, domain_id, model, tools, sdk_image
     Dockerfile          ← FROM registry.gitlab.com/org/atom-sdk:latest
     .gitlab-ci.yml      ← ATOM_BUILD triggered pipeline
     requirements.txt
     .env.example
     README.md           ← auto-generated from agent spec
   Push all files in ONE commit via GitLab Commits API
     POST /api/v4/projects/:id/repository/commits
     { branch: "main", actions: [{ action: "create", file_path, content }...] }
   No local git clone needed — pure API call
   → stream: "✓ All files generated and pushed to GitLab"

6. TRIGGER CI PIPELINE
   GitLab API: POST /api/v4/projects/:id/pipeline
     variables: { ATOM_BUILD: "true", ATOM_IMAGE_TAG: <commit-sha>,
                  SDK_IMAGE: registry.gitlab.com/org/atom-sdk:latest }
   Store pipeline_id + pipeline_url in deployments table
   Poll every 10s: GET /api/v4/projects/:id/pipelines/:pipeline_id
   → stream each poll: "⠋ Building image (pipeline #42)..."
   → on success: "✓ Image built and pushed to registry"
   → on failure: "✗ Pipeline failed — view logs at <url>" + stop

7. DEPLOY TO ATOM-RUNTIME
   atom-studio-api → atom-runtime:
     Submit { agent_id, image: registry.../agent-name:<sha> }
   atom-runtime creates k8s Deployment + Service in atom-agents namespace
   Poll until pod Running
   UPDATE agents SET status=deployed, deployed_at=now()
   → stream: "✓ Deployed to atom-runtime"

8. DONE
   → stream: "✓ Your agent is live"
   WebSocket: AGENT_READY { agent_id, chat_url }
   Right panel: AgentReadyCard with chat link
```

---

## GitLab Platform Config (admin sets once)

```bash
# .env — atom-studio-api
ATOM_GITLAB_URL=https://gitlab.com           # or self-hosted URL
ATOM_GITLAB_GROUP=myorg/atom-agents          # group where agent repos are created
ATOM_GITLAB_PAT=glpat-xxxx                   # PAT: api + write_repository scopes
ATOM_GITLAB_RUNNER_USER=atom-ci-bot          # added as Maintainer to each agent repo
```

The runner has `CI_REGISTRY_*` injected automatically by GitLab for the group.
No per-agent credentials. No user ever sees or sets any of this.

---

## Conversation State Machine

```python
# atom-studio/backend/atom_studio/services/builder_conversation.py

STAGES = [
    "greeting",     # waiting for initial intent
    "clarifying",   # asking follow-up questions (loops)
    "confirming",   # summary shown, waiting for user approval
    "generating",   # non-interactive — repo + files + CI
    "building",     # CI pipeline running
    "deploying",    # atom-runtime deploying
    "done",         # agent live
]

@dataclass
class BuilderState:
    session_id: str
    stage: str                 = "greeting"
    messages: list[dict]       = field(default_factory=list)
    intent: str | None         = None
    agent_name: str | None     = None
    model: str | None          = None
    tools: list[str]           = field(default_factory=list)
    skills: list[str]          = field(default_factory=list)
    a2a_targets: list[str]     = field(default_factory=list)
    hitl_config: dict | None   = None
    # set during deploy:
    agent_id: str | None       = None
    gitlab_project_id: int | None = None
    gitlab_repo_url: str | None   = None
    pipeline_id: int | None       = None
    pipeline_url: str | None      = None
    chat_url: str | None          = None
```

Stored in Redis: `builder_session:{session_id}` TTL 2h.
No Postgres writes until provisioning step in deploy sequence.

---

## Interviewer System Prompt

```python
def build_interviewer_prompt(available_tools: list, available_models: list) -> str:
    tools_list  = "\n".join(f"- {t['name']}: {t['description']}" for t in available_tools)
    models_list = "\n".join(f"- {m}" for m in available_models)
    return f"""
You are the ATOM Agent Builder. Interview the user to understand what agent they need.
You drive the right panel of a split UI — emit structured updates so the panel reflects
resolved fields in real time.

## Rules
- Ask ONE question per turn. Never multiple.
- 3-5 questions is enough. Stop when you have: intent, tools, model, HITL decision.
- Only suggest tools from the available list below. Never invent tool names.
- Auto-suggest atom-hitl if user mentions escalation, approval, or human review.
- Auto-suggest atom-memory if user mentions history, context, or remembering.
- Auto-suggest atom-a2a if user mentions calling or using another agent.
- atom-react-agent, atom-gate-calls, atom-audit are ALWAYS included automatically.
- Derive agent_name from intent: lowercase, hyphenated (e.g. credit-risk-analyser).
- When presenting confirming summary, tell user to review the right panel and click
  Build & Deploy, OR type any changes they want.

## Available MCP tools
{tools_list}

## Available models
{models_list}

## Response format — ALWAYS return JSON, every turn
{{
  "message": "Conversational reply shown in chat",
  "updates": {{
    "agent_name": "...",       // include only fields resolved this turn
    "model": "...",
    "tools": [...],
    "skills": [...],
    "hitl_config": {{...}} or null,
    "a2a_targets": [...]
  }},
  "stage": "clarifying" | "confirming" | "confirmed"
}}

Set stage="confirming" when presenting the summary.
Set stage="confirmed" ONLY when the user explicitly approves
(e.g. "yes", "deploy", "looks good", "go ahead", "deploy it").
"""
```

---

## API Endpoints

```
POST /api/builder/chat
  body:    { session_id?, message }
  returns: SSE stream

  Events:
    { type: "token",        content: "..." }        ← streamed chat token
    { type: "spec_update",  updates: { ... } }      ← drives right panel
    { type: "stage_change", stage: "..." }
    { type: "session_id",   session_id: "..." }     ← on first message
    { type: "done" }

POST /api/builder/deploy
  body:    { session_id }
  returns: SSE stream

  Events:
    { type: "progress", step: "provisioning",   message: "✓ Provisioned agent identity" }
    { type: "progress", step: "codegen",        message: "✓ agent.py generated" }
    { type: "progress", step: "repo_created",   message: "✓ GitLab repo created", url: "..." }
    { type: "progress", step: "permissions",    message: "✓ Permissions configured" }
    { type: "progress", step: "pushed",         message: "✓ All files pushed to GitLab" }
    { type: "progress", step: "pipeline_start", message: "⠋ Building image...", url: "..." }
    { type: "progress", step: "pipeline_poll",  message: "⠋ Building image (2m 10s)..." }
    { type: "progress", step: "pipeline_done",  message: "✓ Image built and pushed" }
    { type: "progress", step: "deployed",       message: "✓ Deployed to atom-runtime" }
    { type: "done",     chat_url: "/chat/agent-uuid" }
    { type: "error",    step: "...", message: "...", retryable: true|false }

GET /api/builder/session/:session_id
  returns: full BuilderState JSON (page refresh recovery)
```

---

## GitLab Service

```python
# atom-studio/backend/atom_studio/services/gitlab_service.py

class GitLabService:
    def __init__(self):
        self.base    = os.environ["ATOM_GITLAB_URL"].rstrip("/")
        self.group   = os.environ["ATOM_GITLAB_GROUP"]
        self.pat     = os.environ["ATOM_GITLAB_PAT"]
        self.headers = {"PRIVATE-TOKEN": self.pat}

    async def create_repo(self, agent_name: str) -> dict:
        r = await httpx.post(f"{self.base}/api/v4/projects", headers=self.headers, json={
            "name": agent_name,
            "namespace_id": await self._group_id(),
            "visibility": "private",
            "initialize_with_readme": False,
        })
        r.raise_for_status()
        return r.json()   # { id, web_url, http_url_to_repo }

    async def set_permissions(self, project_id: int):
        uid = await self._user_id(os.environ["ATOM_GITLAB_RUNNER_USER"])
        r = await httpx.post(
            f"{self.base}/api/v4/projects/{project_id}/members",
            headers=self.headers,
            json={"user_id": uid, "access_level": 40},  # 40 = Maintainer
        )
        r.raise_for_status()

    async def push_files(self, project_id: int, files: dict[str, str]) -> str:
        """Push all files in one commit. Returns commit SHA."""
        r = await httpx.post(
            f"{self.base}/api/v4/projects/{project_id}/repository/commits",
            headers=self.headers,
            json={
                "branch": "main",
                "commit_message": "chore: initial agent scaffold by ATOM builder",
                "actions": [
                    {"action": "create", "file_path": path, "content": content}
                    for path, content in files.items()
                ],
            },
        )
        r.raise_for_status()
        return r.json()["id"]   # commit SHA

    async def trigger_pipeline(self, project_id: int, commit_sha: str) -> dict:
        r = await httpx.post(
            f"{self.base}/api/v4/projects/{project_id}/pipeline",
            headers=self.headers,
            json={
                "ref": "main",
                "variables": [
                    {"key": "ATOM_BUILD",     "value": "true"},
                    {"key": "ATOM_IMAGE_TAG", "value": commit_sha},
                    {"key": "SDK_IMAGE",
                     "value": f"registry.gitlab.com/{self.group}/atom-sdk:latest"},
                ],
            },
        )
        r.raise_for_status()
        return r.json()   # { id, web_url }

    async def pipeline_status(self, project_id: int, pipeline_id: int) -> str:
        r = await httpx.get(
            f"{self.base}/api/v4/projects/{project_id}/pipelines/{pipeline_id}",
            headers=self.headers,
        )
        r.raise_for_status()
        return r.json()["status"]  # created|pending|running|success|failed|canceled
```

---

## Acceptance Criteria

**Conversation:**
- [ ] First message → AI responds with one focused clarifying question
- [ ] Right panel updates live after each AI turn (spec_update events)
- [ ] AI suggests only tools from live `GET /mcp/tools` — never invented names
- [ ] atom-hitl auto-suggested when user mentions escalation/approval
- [ ] AI presents confirming summary after 3-5 questions
- [ ] User can edit any spec row inline — picker shows live data
- [ ] "Deploy it" / "yes" / "go ahead" triggers deploy without extra click

**Deploy automation (all ATOM, zero user action):**
- [ ] Agent identity (agent_id, JWT, LiteLLM key) provisioned
- [ ] agent.py generated via gemini-3.1-pro-preview
- [ ] GitLab repo created under ATOM_GITLAB_GROUP (private)
- [ ] CI bot user added as Maintainer
- [ ] All files (agent.py, atom_agent.yaml, Dockerfile, .gitlab-ci.yml,
      requirements.txt, README.md) pushed in one GitLab Commits API call
- [ ] CI pipeline triggered with correct variables
- [ ] Pipeline progress streamed live in chat — user sees each step
- [ ] Agent deployed to atom-runtime on pipeline success
- [ ] AgentReadyCard + chat link shown on both sides of the panel

**Resilience:**
- [ ] Pipeline failure shows error with link to GitLab pipeline logs
- [ ] Page refresh restores conversation from Redis
- [ ] Any deploy step failure shows clearly with retryable flag

---

## Files to Create / Modify

```
atom-studio/backend/
  atom_studio/services/builder_conversation.py  ← state machine + interviewer prompt
  atom_studio/services/builder_deploy.py        ← 8-step deploy sequence
  atom_studio/services/gitlab_service.py        ← GitLab API wrapper
  atom_studio/routes/builder_chat.py            ← POST /api/builder/chat (SSE)
                                                   POST /api/builder/deploy (SSE)
                                                   GET  /api/builder/session/:id

atom-studio/frontend/
  src/pages/AgentBuilderChat.tsx                ← split panel at /agents/new
  src/hooks/useBuilderChat.ts                   ← chat SSE + spec state
  src/hooks/useBuilderDeploy.ts                 ← deploy SSE + progress
  src/components/builder/
    ConversationPanel.tsx
    AgentSpecPanel.tsx
    SpecRow.tsx                                 ← editable inline row
    ToolsPanel.tsx                              ← live from GET /mcp/tools
    SkillsPanel.tsx                             ← live from GET /api/skills
    HITLRow.tsx
    A2APanel.tsx
    GuaranteesBadge.tsx                         ← non-removable
    DeployButton.tsx
    DeployProgressFeed.tsx                      ← step-by-step in chat
    AgentReadyCard.tsx                          ← chat link

.env.example                                    ← add:
                                                   ATOM_GITLAB_URL
                                                   ATOM_GITLAB_GROUP
                                                   ATOM_GITLAB_PAT
                                                   ATOM_GITLAB_RUNNER_USER
```
