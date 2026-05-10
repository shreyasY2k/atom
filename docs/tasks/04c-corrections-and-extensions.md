# Task 04c — Corrections, Extensions, and Runtime Audit

> **Status**: Tasks 01–04 are complete. Light-theme minimalist
> Google-styled UI is working. This task patches the platform with five
> connected fixes caught after Studio was used in development:
>
> 1. Agent skill format aligned with AgentScope's upstream skills
>    repository (skills vs agent roles disambiguation).
> 2. `reasoning_mode` becomes a first-class per-agent field
>    (prescribed | guided | open-reserved).
> 3. Agents accept free-text input via an extraction adapter, in addition
>    to structured JSON (which workflow nodes continue to use).
> 4. Builder UI's Test panel becomes a chat-style surface with an inline
>    trace pane — Studio-style UX, our visual style.
> 5. Audit and confirm: every deployed agent is running through
>    AgentScope Runtime's `DeployManager`, not bypass-deployed via raw
>    `docker run`.
>
> Do this BEFORE task 05. Several of these touch shared abstractions
> (agent spec, builder skill, Test panel) that downstream tasks build on.

## Goal

Five outcomes, one session:

1. Skills vs Agent Roles separated cleanly. AgentScope's upstream skills
   library becomes a pinned dependency providing the capability layer;
   our domain files become **agent role definitions** that compose
   upstream skills.
2. Every agent spec has `reasoning_mode: prescribed | guided`. ATS demo
   agents stay `prescribed`. New `guided` example added for the demo's
   "build any kind of agent" story.
3. Every deployed agent's `/invoke` endpoint accepts both structured
   JSON (workflow path) and `{"text": "..."}` (chat path). Free text
   goes through a Gemini Flash extraction step before agent execution.
4. Builder UI's Test panel: chat-style input + conversation history +
   collapsible inline trace pane (LLM calls and tool calls). Uses our
   existing light theme. Has "Open in Studio →" link for engineers.
5. Confirmed: every deployed agent is created through
   `agentscope_runtime.engine.deployers.LocalDeployManager`. If task 03a
   is bypassing it, fix.

## Why this matters

- A bank prospect with AgentScope familiarity will ask "are you using
  their skills library?" — answer must be yes.
- "Does the agent decide what to do?" — answer must be specific per
  agent (mode field), not "depends on the skill we wrote."
- A demo audience can't type free text into the agent. Studio's chat
  UI sends free text. That mismatch makes the platform feel broken.
- Inline traces in the Builder UI convert "we have audit logs" from a
  claim into a watchable feature.
- Bypassing AgentScope Runtime means we lose the upgrade path to
  Kubernetes/Kruise in Phase 2 and quietly fork the framework.

## Hard rules — do not violate

1. **Do not change behaviour of the four existing agents** beyond adding
   the input adapter. The four agents must produce byte-identical agent
   output for the same structured input pre- and post-this-task.
2. **Do not redesign the existing UI.** Light-theme minimalist Google-style
   stays. Chat and trace additions match the existing palette and spacing.
3. **Do not fork AgentScope Studio components or iframe Studio** into the
   prospect-facing flow. Reimplement the UX patterns (chat bubbles,
   collapsible trace) in our own React components. The "Open in Studio →"
   link is for engineers; it opens Studio in a new tab.
4. **Do not change the workflow's invocation contract.** Workflow nodes
   continue to send structured JSON to agents. Free text is exposed only
   to the Test panel and direct API users.
5. **Do not introduce upstream AgentScope skills to the four ATS/treasury/
   insurance agents.** They use domain tools, not generic capabilities.
   Adding upstream skills could shift confidence scores. Use the new
   `transaction-anomaly-triage` agent (Part B.4) as the upstream-skills
   showcase.
6. **Pin AgentScope skills to a specific commit SHA**, not a tag or
   branch. Floating refs break demos on random Tuesdays. The SHA goes
   into `requirements.txt`.
7. **Do not delete the old `skills/<domain>/` folders until tests pass.**
   Move-and-verify pattern. Delete only after agents reproduce expected
   outputs.

---

## Part A — Skills vs Agent Roles refactor

### A.1 Rename the abstraction

| Old name | New name | Where |
|---|---|---|
| Skill (domain file) | **Agent role** | `skills/<domain>/*.skill.md` → `agent-roles/<domain>/*.role.md` |
| Skill (builder, composer meta) | Generation skill — unchanged | `skills/builder/SKILL.md`, `skills/composer/SKILL.md` stay |
| (none) | **Skills (capability)** | New: AgentScope upstream skills, imported as pinned dependency |

Repo layout after migration:

```
atom/
├── agent-roles/                       # NEW (was skills/<domain>/)
│   ├── ats/
│   │   ├── kyc-refresh.role.md
│   │   └── asset-recon.role.md
│   ├── treasury/
│   │   ├── liquidity-analyst-maker.role.md
│   │   └── risk-reviewer-checker.role.md
│   ├── insurance/
│   │   ├── document-extractor-maker.role.md
│   │   └── coverage-validator-checker.role.md
│   └── banking-fraud/                 # NEW (B.4)
│       └── transaction-anomaly-triage.role.md
├── skills/                            # KEEP — generation skills only
│   ├── builder/SKILL.md
│   └── composer/SKILL.md
└── (everything else unchanged)
```

### A.2 Add the upstream-skills dependency

In `builder-backend/requirements.txt` and the deployed-agent base image:

```
agentscope-skills @ git+https://github.com/agentscope-ai/agentscope-skills@<PINNED_SHA>
```

Replace `<PINNED_SHA>` with a verified SHA. Document it in
`docs/architecture.md` under "Build-from-source policy."

### A.3 Extend the agent-spec schema

In `docs/agent-spec-format.md`, the per-agent block becomes:

```yaml
spec:
  agents:
    - name: <agent-name>
      role: agent-roles/<domain>/<name>.role.md   # was: skill: skills/<domain>/<name>.skill.md
      agentscope_skills:                          # NEW, optional, default []
        - doc_parser                              # imported from upstream skills lib
        - web_search
      reasoning_mode: prescribed                  # NEW, required (Part B)
      input_schema:                               # NEW, required (Part C)
        type: object
        required: [customer_id]
        properties:
          customer_id:
            type: string
            description: The customer ID to refresh KYC for, e.g. CUST-100442
      # ... rest unchanged
```

### A.4 Update the builder skill

`skills/builder/SKILL.md` updates:

- Reads the role file at the path in `role:` (was: `skill:`)
- For every name in `agentscope_skills`, imports from `agentscope_skills`
  package and adds to the agent's `toolkit` alongside resolved domain tools
- Validates upstream skills against an allowlist defined in
  `builder-backend/core/upstream_skills.py`
- The generated `agent.py` continues to read the role file at runtime;
  only the path changes

### A.5 Migration order — exactly this

1. Create `agent-roles/` directory structure.
2. **Copy** (don't move) every `skills/<domain>/*.skill.md` to
   `agent-roles/<domain>/*.role.md`. File contents unchanged.
3. Update every spec in `specs/agents/*.yaml`: change `skill:` to `role:`,
   add `reasoning_mode: prescribed`, add `input_schema`.
4. Update `builder-backend` to read `role` field. Keep a one-cycle
   compatibility shim that accepts either `skill` or `role`, with a
   deprecation log line when `skill` is used.
5. Update `cli/atom.py agent scaffold` to write to `agent-roles/`
   and emit `role:` in the spec.
6. Run existing agent tests (Test panel + golden tests). All four ATS/
   treasury/insurance agents must produce byte-identical agent output
   for the same structured input. **If anything drifts, the migration
   is wrong — diagnose before continuing.**
7. Once green, delete the old `skills/<domain>/` directories.
8. Remove the compatibility shim from builder-backend.

### A.6 Architecture doc

In `docs/architecture.md`, before "Identity model," add:

```markdown
## Skills vs Agent Roles

The platform has two distinct concepts that overlap in name across the
industry. We disambiguate strictly:

**Skills (upstream, capability layer).** Reusable Python modules from
AgentScope's `agentscope-skills` library. Each provides a callable tool
or set of tools — document parsing, web search, browser use, structured
extraction. Imported as a pinned dependency. Generic across domains.

**Agent roles (ours, role-definition layer).** Markdown files at
`agent-roles/<domain>/<name>.role.md` defining an agent's purpose,
boundaries, output contract, and reasoning approach. Domain-specific.
Composes upstream skills + registered domain tools.

**Generation skills (ours, meta layer).** Markdown files at
`skills/builder/` and `skills/composer/`. Used by the platform itself
to turn specs into code (builder) or prose into specs (composer). Not
loaded by deployed agents; only by the platform's own LLM calls.

A deployed agent at runtime has access to: (1) registered domain tools
from `tools/registry.py`, (2) upstream skills declared in
`agentscope_skills:`, governed by the agent's role definition.
```

---

## Part B — Reasoning modes

### B.1 Add `reasoning_mode`

In `docs/agent-spec-format.md`:

| Value | Role file shape | Generated code behaviour |
|---|---|---|
| `prescribed` | Role enumerates exact tool calls in order | Agent runs ReAct loop; role steers tightly. Maximum determinism. |
| `guided` | Role describes goals + tool catalog with hints; "decide which to call" | Agent reasons about which tools to call. Same output schema; tool path varies. |
| `open` | Role describes goals only | Pure ReAct. **V1: rejected by validator with "available in Phase 2."** |

### B.2 Existing agents stay prescribed

| Agent | reasoning_mode |
|---|---|
| `kyc-refresh` | `prescribed` |
| `asset-recon` | `prescribed` |
| `treasury-liquidity-briefing` (maker + checker) | `prescribed` |
| `insurance-claim-ocr` | `prescribed` |

Don't change anything else about these specs except the field additions
in A.3.

### B.3 Builder skill emits two patterns

`skills/builder/SKILL.md` updates to know about both modes:

**`prescribed`** (existing): role file goes verbatim into `sys_prompt`.

**`guided`**: role file goes into `sys_prompt`, augmented with a tool
catalog block:

```python
TOOL_CATALOG = """
You have these tools available. Choose which to call based on what you
need to learn from the input. You don't have to call all of them.

- get_customer_profile(customer_id) — current KYC profile
- get_kyc_documents(customer_id) — documents on file with staleness
- get_external_screening(customer_id) — adverse-media + PEP screening
"""

<agent_name>_sys_prompt = <role_text> + "\n\n" + TOOL_CATALOG
```

### B.4 Add `transaction-anomaly-triage` (guided example)

Create:

- `agent-roles/banking-fraud/transaction-anomaly-triage.role.md` —
  describes purpose ("investigate flagged transaction; figure out
  what's unusual; recommend escalate or close"). Goals, no prescribed
  sequence.
- `specs/agents/transaction-anomaly-triage.yaml` —
  `reasoning_mode: guided`, domain tools (`get_transaction_history`,
  `get_customer_baseline`, `get_peer_segment_stats`), `agentscope_skills:
  [web_search]` (look up unfamiliar merchant names).
- A small mock service or extension to `kyc-svc` providing the
  transaction tools. Stub-grade; doesn't need to be domain-correct.

Ship it. **Do not wire it into ATS workflow.** It exists to:

1. Demonstrate the platform supports `guided` mode.
2. Demonstrate the platform composes upstream AgentScope skills.
3. Provide a second live-build example for the demo.

### B.5 Workflow validator

When an `agent` workflow node references a `guided`-mode agent, log a
soft warning (not error). Document in `docs/workflow-spec-format.md`:
"guided agents have variable reasoning paths; workflow-level golden
tests need wider tolerance."

---

## Part C — Free-text input adapter

### C.1 Update generated agent code

In the deployed agent's FastAPI app (generated from the builder skill),
the `/invoke` endpoint accepts both shapes:

```python
@app.endpoint("/invoke")
async def invoke(payload: dict) -> dict:
    if "text" in payload and not _looks_structured(payload):
        # Free-text path (chat / Test panel)
        structured = await _extract_input_from_text(
            text=payload["text"],
            schema=AGENT_INPUT_SCHEMA,
        )
    else:
        # Structured path (workflow's path — unchanged)
        structured = payload

    return await <flow_run_function>(structured)


async def _extract_input_from_text(text: str, schema: dict) -> dict:
    response = await litellm_client.chat.completions.create(
        model="gemini-3-flash",
        messages=[
            {"role": "system", "content": (
                "Extract the structured input fields from the user's "
                "message. Return JSON conforming to the provided schema. "
                "If a required field cannot be confidently extracted, "
                "return null for that field."
            )},
            {"role": "user", "content": text},
        ],
        response_format={"type": "json_schema", "json_schema": schema},
        temperature=1.0,
    )
    return json.loads(response.choices[0].message.content)
```

`_looks_structured()` returns true if payload has any of the agent's
required fields at top level. Defensive against `{"text": "...", "customer_id": "..."}`
ambiguity.

### C.2 Builder skill emits this

Update `skills/builder/SKILL.md` to include the input-adapter section
in every generated agent file. The `AGENT_INPUT_SCHEMA` constant is
populated from the spec's `input_schema` field.

### C.3 Test the adapter

For each agent, both paths produce equivalent agent output:

```bash
# Structured (workflow's path)
curl -X POST http://localhost:8100/invoke \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "CUST-100442"}'

# Free text (chat path)
curl -X POST http://localhost:8100/invoke \
  -H "Content-Type: application/json" \
  -d '{"text": "refresh KYC for customer CUST-100442"}'
```

Add to each agent's golden test suite as a new test case. Wider
tolerance bounds for the free-text path acceptable (Gemini variance in
extraction step).

---

## Part D — Builder UI: chat surface + inline traces

Visual style notes: match the existing light-theme minimalist Google
look. No avatars on chat bubbles. No emoji icons. No timestamps in
line — hover to reveal. Subtle borders, generous whitespace, the
existing color palette only. The goal is "Studio's UX, Atom's
brand."

### D.1 Chat-style input

Replace the structured-JSON form in the Test panel with:

```
┌─────────────────────────────────────────────────────────┐
│  Chat with kyc-refresh                                  │
│                                                         │
│  [conversation history, oldest first]                   │
│                                                         │
│  user (right-aligned, light-gray bubble):               │
│   "refresh KYC for customer CUST-100442"                │
│                                                         │
│  agent (left-aligned, white bubble, thin border):       │
│   {confidence: 0.94, recommendation: "PASS", ...}       │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │ Type a message...                                 │  │
│  └───────────────────────────────────────────────────┘  │
│  Sample prompts:                                        │
│   [Refresh CUST-100442]                                 │
│   [Check stale-doc customer]                            │
│   [Try a high-value transfer]                           │
│                                                         │
│  [Send]   [Clear]              [Open in Studio →]       │
└─────────────────────────────────────────────────────────┘
```

Sample prompts derived from the agent's spec metadata. For each agent,
add 2–3 sample prompts to the spec under a new `sample_prompts:` array
(optional field).

### D.2 Inline trace pane

Below the chat, a collapsible pane:

```
▼ Trace · 6 LLM calls · 3 tool calls · 3.4s

   1. [LLM] gemini-3.1-pro · sys + user · 1240 tokens · 820ms
      ▶ View prompt + response

   2. [TOOL] get_customer_profile(customer_id="CUST-100442") · 84ms
      ▶ View arguments + result

   3. [LLM] gemini-3.1-pro · reasoning · 1580 tokens · 1.2s
      ▶ View prompt + response

   ...
```

Source the data from the run's audit events in MinIO (we already log
every LLM and tool call). One round trip per Test panel invocation
fetches the run's events from `builder-backend GET /agents/<name>/runs/<run_id>/events`
(new endpoint). Render in order. Each row expandable.

### D.3 Mode badge in result

In the agent's response bubble, render a small mode badge in the
bubble's metadata row:

`[prescribed]` (gray pill) or `[guided]` (blue pill)

Helps the audience and the agent's user see which mode is in play.

### D.4 "Open in Studio →"

Link in the panel header. Opens Studio in a new tab, filtered to this
agent's most recent run. **Do not iframe Studio.** Engineers click
through; prospects don't notice it's there.

### D.5 Composer agent-node Inspector

When inspecting an `agent` workflow node, show the agent's
`reasoning_mode` as a read-only field. If `guided`, render a small
caution chip: "variable reasoning — output schema fixed, tool path
may vary across runs."

---

## Part E — Runtime audit and fix

### E.1 Audit

Verify how task 03a's `/agents/{name}/deploy` endpoint actually creates
the agent container. Open `builder-backend/app/core/container.py` (or
equivalent). Look for one of:

- ✅ Imports `from agentscope_runtime.engine.deployers import LocalDeployManager`
  and uses it. **Pass — no fix needed.**
- ❌ Calls `docker.from_env().containers.run(...)` directly without
  going through AgentScope Runtime. **Fail — fix in E.2.**
- ❌ Uses a custom Dockerfile-build + `docker run` shell-out flow that
  doesn't reference AgentScope Runtime's deployer at all. **Fail —
  fix in E.2.**

Document what was found in `docs/tasks/_session-log.md`.

### E.2 Fix if bypassed

If the deploy path bypasses AgentScope Runtime, refactor:

```python
from agentscope_runtime.engine.deployers import LocalDeployManager

async def deploy_agent(spec: AgentSpec, code_path: str, env: dict) -> DeploymentResult:
    deploy_mgr = LocalDeployManager(
        workdir=f"/tmp/deployments/{spec.name}/{spec.version}",
    )
    result = await deploy_mgr.deploy(
        agent_module="agent",   # the generated agent.py
        port=allocate_port(spec.name),
        env=env,                # includes LITELLM_API_KEY (service-account VK)
                                #          SERVICE_ACCOUNT_ID
                                #          REME_URL
                                #          domain svc URLs
    )
    return result
```

The wrapper class that AgentApp produces in the generated code is what
`DeployManager` knows how to serve. Confirm the generated code uses
`AgentApp` (it should, per the builder skill).

### E.3 Verify Studio integration

After E.1 / E.2:

- Deploy `kyc-refresh` from the Builder UI.
- Open Studio at `localhost:3000`.
- The agent should appear in Studio's agent list.
- Send a test invocation from Studio's chat UI.
- The invocation should route to the deployed agent and return.

If Studio doesn't see the agent: AgentScope Runtime's deployer
registers agents with a runtime registry that Studio queries.
Confirm builder-backend isn't deploying to a separate registry.

### E.4 Document the deployment topology

Update `docs/architecture.md`:

```markdown
## Deployment topology — agents

Every deployed agent runs as a containerized FastAPI service spawned
by AgentScope Runtime's `LocalDeployManager` (Phase 1) or
`KubernetesDeployManager` / `KruiseDeployManager` (Phase 2). The
container is the Runtime's deployment artifact, not a separate
abstraction.

The deployment env injects:
- `LITELLM_API_KEY` — the agent's service-account virtual key
- `SERVICE_ACCOUNT_ID` — the agent's identity for audit
- `REME_URL` — memory service endpoint
- Domain service URLs — KYC, OFAC, SWIFT, etc.

The `AgentApp` wrapper in the generated code exposes `/invoke` and
`/health` on the container's port. Studio queries the Runtime registry
to discover agents and routes chat through the same `/invoke`.
```

---

## Part F — Documentation updates

### F.1 CLAUDE.md decision log

Add four entries:

| Decision | Why |
|---|---|
| Two-layer skill model: AgentScope skills + agent roles | Aligns with upstream; "agent role" disambiguates from upstream "skill"; positions us as composing AgentScope, not reinventing |
| `reasoning_mode` field per agent | Makes the prescribed-vs-guided trade-off explicit per agent rather than implicit in role prose; supports the BFSI auditability story (prescribed) and the platform flexibility story (guided) |
| Free-text input adapter on every agent | Enables Studio chat compatibility and the Test panel's chat surface without changing the workflow's structured invocation contract |
| Studio reused as engineer surface, not embedded as prospect surface | Studio's chrome confuses non-technical demo audiences; we reimplement the UX patterns (chat, traces) in our own UI; link to Studio for engineers |

### F.2 Task 07 (rehearsal) Q&A additions

1. **"Are you using AgentScope's skills library?"** Yes, as the upstream
   capability layer. Pinned dependency. Agent roles compose upstream
   skills with domain tools and instructions. We didn't reinvent.
2. **"Does the agent decide what to do, or follow a script?"** Both,
   per agent. ATS production agents are prescribed for auditable BFSI
   ops. The triage agent we just demoed is guided. You choose per agent.
3. **"How do I add a new capability not in your tool list?"** Two ways.
   Generic capability → install corresponding AgentScope skill. Bank-
   specific integration → register a tool with the platform (10-line
   change + gateway guardrail entry).
4. **"Can I chat with my agent without involving a workflow?"** Yes —
   the Test panel is a chat surface; agents take free-text input.
   Engineers can also use Studio for the same conversation with deeper
   trace inspection.
5. **"How are agents actually deployed?"** AgentScope Runtime spawns a
   containerized FastAPI service per agent. In Phase 2, the same code
   deploys to Kubernetes via Kruise. Container is the Runtime's
   deployment unit, not a workaround.

### F.3 README

Add to "What this is":

> Built on AgentScope: upstream skills as the capability layer, our
> agent roles as the domain composition layer. Pinned dependency, not
> a fork. Agents deploy via AgentScope Runtime; chat surfaces work
> from both our UI and Studio.

---

## Definition of Done

- [ ] `agent-roles/` directory exists; all four ATS/treasury/insurance
      roles migrated; old `skills/<domain>/` deleted
- [ ] All four agent specs reference `role:`, have `reasoning_mode:
      prescribed`, have `input_schema`, optionally have `sample_prompts`
- [ ] `agentscope-skills` pinned to a SHA in `requirements.txt`
- [ ] Builder backend validates `role` and `agentscope_skills`
- [ ] Builder skill emits correct code for both `prescribed` and
      `guided` modes; rejects `open`
- [ ] Builder skill emits the free-text input adapter in every
      generated agent
- [ ] All four existing agents deploy and produce byte-identical agent
      output for the same structured input (verify via Test panel +
      golden tests)
- [ ] `transaction-anomaly-triage` agent deploys, invokable via Test
      panel, demonstrates `guided` mode + `agentscope_skills` use
- [ ] Each agent's `/invoke` accepts both structured and `{"text":
      "..."}` payloads; both paths covered in golden tests
- [ ] Builder UI Test panel renders chat-style input + sample prompts +
      conversation history + collapsible inline trace
- [ ] Result bubble shows mode badge
- [ ] "Open in Studio →" link works
- [ ] Composer agent-node Inspector shows `reasoning_mode`; guided
      agents get a caution chip
- [ ] AgentScope Runtime audit complete; if it was bypassed, deployment
      path now uses `LocalDeployManager`
- [ ] Studio's chat UI can reach a deployed agent and invocation works
- [ ] Architecture doc has the "Skills vs Agent Roles" section and the
      "Deployment topology — agents" section
- [ ] CLAUDE.md decision log has four new entries
- [ ] Q&A doc has five new questions
- [ ] README updated

## Common pitfalls

- **Compatibility shim becomes permanent.** Set a calendar reminder to
  remove the dual-field `skill | role` reader after this task. Don't
  merge it as permanent.
- **Upstream skills pinned to a tag, not a SHA.** Tags can move. Use a
  SHA. Verify with `pip show agentscope-skills` after install.
- **Guided agent's confidence drifts across paths.** Variable tool-call
  paths mean confidence has to be computed consistently. Spend time on
  the role file's confidence rubric.
- **Free-text adapter latency added to demo paths.** The extraction
  step adds ~600–900ms. For demo, prefer structured input on the
  workflow's path; use chat only for Builder Test panel demos. Both
  work; mind the latency.
- **Test panel chat replaces the structured form entirely.** It
  shouldn't. Keep an "Edit raw JSON" toggle for engineers who want to
  test the structured path. Chat is the default; raw JSON is one click
  away.
- **Trace pane fetches all events synchronously.** For long-running
  agents (treasury maker-checker can be 12+ LLM calls), lazy-load.
  First 5 events on initial render; "load more" for the rest.
- **Studio integration breaks because agent registry is internal to
  builder-backend.** AgentScope Runtime has its own registry; Studio
  queries that one. Builder-backend's registry is for *our* metadata
  (owner, deploy time, virtual key id). Both are needed; they're not
  the same.
- **Generated `transaction-anomaly-triage` ends up in the ATS
  workflow.** It shouldn't. If anyone wires it into ATS before V2,
  revert.
- **Renaming breaks the composer skill's examples.** `skills/composer/SKILL.md`
  has examples referencing `skill:`. Update to use `role:` and add
  `reasoning_mode` to the example workflow-spec output.

## What this task does NOT do

- Does not change ATS workflow behaviour
- Does not add `open` reasoning mode (Phase 2)
- Does not refactor the four-node-type workflow model
- Does not change identity / audit / Temporal logic
- Does not redesign the existing UI's color palette or layout
- Does not fork or iframe AgentScope Studio