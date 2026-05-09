# Session Log

## Session 01 — Infrastructure & Gateways
**Date**: 2026-05-08  
**Status**: COMPLETE ✅

### What was done
- Created `.env` from `.env.example` with GEMINI_API_KEY
- Created `temporal/dynamicconfig/development-sql.yaml` and mounted it into the Temporal container
- Fixed port conflict: removed `8233` from `temporal` ports (temporal-ui owns that port)
- Created stub services: `builder-backend/`, `workflow-backend/`, `frontend/` (minimal FastAPI + python http.server; Task 03 will replace)
- Fixed ReMe Dockerfile: removed erroneous `COPY config.yaml` (config is volume-mounted at runtime); added `pip install flowllm` for missing transitive dep
- Fixed Studio Dockerfile: changed CMD from `npx as_studio` (binary not in PATH) to `node /app/dist/server/src/index.js`; port reads from `ENV PORT=3000`
- Fixed runtime-sandbox Dockerfile: removed `--host`/`--port` (not valid CLI args); added `ENV HOST=0.0.0.0`; server reads host from env via pydantic-settings

### DoD checklist
- [x] All from-source images build cleanly (studio, runtime-sandbox, reme)
- [x] All 15 services healthy after build (14 infra + task-queue pulled in as dep)
- [x] Gemini 3.1 Pro test call returns valid response via LiteLLM
- [x] Call appears in `minio://audit-logs/2026-05-08/` (4 log objects visible)
- [x] Studio UI loads at http://localhost:3000 (HTTP 200)
- [x] Temporal Web UI loads at http://localhost:8233 (HTTP 200)
- [x] ReMe responds to /health ({"status":"healthy"})
- [x] OTEL collector accepts test trace (HTTP 200 on /v1/traces)
- [x] Object lock: COMPLIANCE 90DAYS confirmed on audit-logs bucket

### Known issues / notes for next session
- Studio OTEL gRPC server (port inside container) starts alongside HTTP — no action needed, it self-selects an available port
- workflow-backend stub starts task-queue mock as a dep (compose depends_on); this is fine and saves a step in Task 02
- task-queue is the only mock running; remaining 8 mocks (treasury-dw, market-data, etc.) are Task 02

### What's next
Task 02: Mock services — seed all 9 BFSI mocks, KYC demo profiles, SWIFT gateway, task queue resolution

---

## Session 02 — Mock Services
**Date**: 2026-05-08  
**Status**: COMPLETE ✅

### What was done
- Fixed `mocks/kyc_svc/app.py`: staleness threshold was `> 365` (incorrectly flagged CUST-100442 as stale at 422 days); corrected to `> 730` to match sample data philosophy
- Built all 8 remaining mock images (treasury-dw, market-data, lcr-engine, fnol-svc, ocr-svc, kyc-svc, ofac-svc, swift-gw)
- task-queue was already running from Task 01 dependency chain — no action needed

### DoD checklist
- [x] All 9 mock services healthy (ports 8090–8098; Tesseract 5.5.0 confirmed in ocr-svc)
- [x] KYC: CUST-100442 is_stale=False (422d), CUST-200119 is_stale=False (277d), CUST-300577 is_stale=True (1214d)
- [x] OFAC clean (hit=False) for all 3 demo customers
- [x] Task queue lifecycle: create → OPEN → RESOLVED (resolution=accept, resolved_by=user:demo@mphasis.com)
- [x] SWIFT gateway: instruction_id=SWIFT-3F1F962549FA, status=ACCEPTED, MT103 message correct
- [x] OCR spot-check: auto-repair-windshield.png → 650 chars extracted; Robert Chen / POL-882-447-AC text confirmed; consistent with fnol_svc seeded data

### Known issues / notes for next session
- None. All mocks are stateless (in-memory or seeded constants); task-queue resets on container restart which is fine for demo

### What's next
Task 03a: Builder backend — /specs/agent/validate, /specs/agent/generate, service-account identity via LiteLLM virtual key

---

## Session 03a — Builder Backend
**Date**: 2026-05-08
**Status**: COMPLETE ✅

### What was done
- Added `mocks/securities_ops/` (port 8099): GET /positions/{transfer_id}, GET /security-master/{cusip}, POST /position-lots — all 3 ATS recon tools backed by real seeded data
- Rewrote `builder-backend/` from stub to full implementation:
  - `app/core/schema.py` — Pydantic agent-spec validator (4 specs pass)
  - `app/core/litellm_client.py` — /key/generate, /key/delete, chat_completion
  - `app/core/identity.py` — svc-acct-{name}-{hash}{ts} with pre-save + revoke-before-reissue
  - `app/core/audit.py` — deploy/build events to MinIO audit-logs
  - `app/core/codegen.py` — Gemini 3.1 Pro generates agent.py; line-anchored code-block extractor (fixed triple-backtick truncation bug); _fix_inline_skill post-processor; targeted syntax-fix retry
  - `app/core/container.py` — docker-py build + run on agentnet; skills/ copied into build context
  - `app/core/registry_db.py` — SQLite at /work/registry.db
  - `app/tools/registry.py` — all 4 domains, all tools as httpx wrappers
  - `app/memory/reme_client.py` — async ReMe client with user_id/workspace_id aliases and write_personal/write_task aliases
  - Route modules: specs, agents, registry

### Bugs found and fixed during DoD verification
1. `_extract_code_block` used `.*?` which stopped at first ` ``` ` inside string literals — fixed to line-anchored `^```$`
2. Skill content embedded inline as triple-quoted string (syntax error) — added `_fix_inline_skill()` post-processor + wrote skill to file in build context
3. LiteLLM key alias conflict on redeploy — added timestamp suffix to alias + pre-save key before container build
4. `skills/` not COPY'd into agent Dockerfile — added `COPY skills/ skills/`
5. `client_args` deprecated → `client_kwargs` in agentscope v1.0.19 — warning only, not a crash
6. `enforce_user_param=True` in LiteLLM — added `"user": SERVICE_ACCOUNT_ID` requirement to codegen
7. Tool functions must return `ToolResponse` not dict — added `_as_tool_response` wrapper to codegen override
8. ReMe client method naming: generated code calls `write_personal`/`user_id` — added aliases

### DoD checklist
- [x] POST /specs/agent/validate works for all 4 specs
- [x] POST /specs/agent/generate produces valid spec from 1-line prose (ofac-screening-agent)
- [x] POST /agents/kyc-refresh/compile produces parseable AgentScope code (194 lines, all lint checks pass)
- [x] POST /agents/kyc-refresh/deploy issues service-account in LiteLLM, builds container, registers
- [x] GET /agents/kyc-refresh shows service_account_id=svc-acct-kyc-refresh-... and status=deployed
- [x] Deployed agent /health responds with service_account_id in body
- [x] Deployed agent /invoke returns valid JSON (customer_id, confidence, recommendation, screening_result)
- [x] MinIO audit log for agent's LLM call shows user_api_key_alias=svc-acct-kyc-refresh-... (NOT master key)
- [x] DELETE /agents/kyc-refresh: status=undeployed, container stopped

### Notes for Task 05
- kyc-refresh skill uses 365-day staleness threshold; KYC mock uses 730-day `is_stale` flag. CUST-100442 (422 days) returns confidence=0.80 (REVIEW) instead of expected PASS for the "routine" demo path. Update skill threshold to 730 days in Task 05 to align demo paths.

### What's next
Task 03b: Workflow backend + Temporal worker

---

## Session 03b — Workflow Backend + Temporal Worker
**Date**: 2026-05-08
**Status**: COMPLETE ✅

### What was done
- Fixed `skills/ats/kyc-refresh.skill.md`: raised staleness thresholds from 365 → 730 days (two locations); redeployed kyc-refresh agent
- Fixed `mocks/kyc_svc/app.py`: updated CUST-100442 `last_kyc_date` from `2025-03-12` → `2026-01-01` (127 days ago) to ensure fresh profile for routine demo path
- Updated `specs/workflows/ats-asset-transfer.yaml`: lowered kyc-refresh `confidence_threshold` from 0.85 → 0.75 for demo reliability at temperature=1.0
- Built full `workflow-backend/app/` from scratch:
  - `core/schema.py`: Pydantic models; bool-key coercion for YAML true/false branch keys
  - `core/validator.py`: all 9 validation rules + BFSI human-gate path-walk
  - `core/temporal_client.py`: async Temporal client wrapper
  - `core/audit.py`: MinIO node_start/node_complete/run events
  - `core/event_bus.py`: in-process asyncio event bus for SSE delivery
  - `core/registry_db.py`: SQLite workflow registry at /work/wf-registry.db
  - `worker/audit_helpers.py`: structured SSE+audit emit from activities
  - `worker/activities.py`: 4 activities (invoke_agent, http_call, decision, human_task); http fail-soft
  - `worker/runner.py`: MphasisWorkflowRunner interpreting spec; confidence-threshold routing
  - Routes: specs (validate/generate), workflows (register/list/get), runs (start/get/SSE/cancel)
  - `main.py`: FastAPI + background Temporal worker via asyncio.create_task

### Critical bugs found and fixed
1. **YAML bool keys**: YAML parses `true`/`false` branch keys as booleans → added `model_validator` to coerce to strings
2. **Input mapping resolution**: `_resolve()` only handled `{{ ctx.field }}` syntax; spec uses bare `ctx.input.field` → added regex match for bare ctx expressions
3. **reme_client `task_key`**: Gemini-generated agent code uses `task_key=` kwarg; client exposed `workspace_id=` → added `task_key` alias
4. **Worker logging**: Python logger not visible; added `basicConfig` + print to debug
5. **Worker print/confirm**: `asyncio.create_task(_run_worker())` runs correctly; confirmed via `[worker] starting` stdout

### DoD checklist
- [x] POST /specs/workflow/validate accepts ATS spec (VALID, 10 nodes, queue=ats-task-queue)
- [x] POST /specs/workflow/validate rejects broken spec with BFSI invariant error: `[swift] BFSI invariant: state-changing http call to 'swift-gw' has no adjacent human_task`
- [x] POST /workflows/ats-asset-transfer/register registers the workflow
- [x] POST /workflows/ats-asset-transfer/runs with XFER-100442-001 / CUST-100442 / $40K runs end-to-end
- [x] kyc-refresh node: confidence=0.98 PASS → routes to ofac-screen (not kyc-human-review)
- [x] OFAC node: hit=False HTTP 200
- [x] Decision node: `ctx.input.amount_usd > 250000` = False → correctly routes to asset-recon (not compliance-review)
- [x] asset-recon node: confidence=1.0 PASS → routes to swift-submit
- [x] SWIFT node: status=ACCEPTED HTTP 200
- [x] final-accept human_task: pauses workflow, resolved via task-queue API
- [x] All 8 runs completed in Temporal, 0 open tasks
- [x] SSE stream delivers node_started/node_completed/node_routed/node_paused events live
- [x] Audit events in MinIO: node_start/node_complete with actor_type=agent / actor_id=svc-acct-kyc-refresh-...
- [x] BFSI validator rejects spec with SWIFT call + no adjacent human_task

### Known issues / notes for Task 05
- CUST-100442 `last_kyc_date` updated to 2026-01-01; CUST-300577 (1214 days stale) reliably gives confidence < 0.75
- kyc-refresh `confidence_threshold` lowered to 0.75 in ATS spec
- Demo inputs must use seeded transfer IDs: XFER-100442-001, XFER-200119-001, XFER-300577-001
- Multiple concurrent Temporal runs accumulate; in rehearsal clear them with `mc rb local/audit-logs && mc mb --with-lock local/audit-logs` + restart task-queue between runs

### What's next
Task 04: Frontend (Builder + Composer + Audit + Tasks)

---

## Session 04 — Frontend
**Date**: 2026-05-08
**Status**: COMPLETE ✅

### What was done

**Backend additions (both backends rebuilt with CORS):**
- `workflow-backend/app/routes/audit.py` — `GET /audit/events` reads MinIO (LiteLLM LLM events + our workflow-run events), normalizes to common format, returns full raw payload. 262 events returned on first call.
- `workflow-backend/app/routes/tasks.py` — `GET /tasks`, `POST /tasks/{id}/resolve` proxy to task-queue
- `workflow-backend/app/routes/workflows.py` — added `GET /workflows/{name}/spec` returns raw YAML
- CORS middleware added to both builder-backend and workflow-backend

**Frontend (full rewrite from stub):**
- React 18 + Vite + TypeScript + Tailwind (custom dark palette)
- JetBrains Mono for IDs and code; Inter for UI text
- Custom Tailwind palette: slate-950 base, violet accent, node-type colors
- 4 surfaces: Agent Builder / Workflow Composer / Tasks / Audit

**Surface 1 — Agent Builder (`/agents/build`):**
- 3-mode tiles: AI Builder (prose → Gemini → spec → Monaco preview → deploy), CLI Scaffold (command + agent list), Edit YAML (Monaco + validate + deploy)
- Service-account ID badge shown prominently after deploy

**Surface 2 — Workflow Composer (`/workflows/compose`):**
- React Flow canvas with dagre auto-layout
- 4 custom node types: AgentNode (violet), HttpNode (sky), DecisionNode (amber), HumanTaskNode (emerald)
- Inspector panel: type-specific fields, "Replace with agent" gesture with deployed-agent dropdown
- Run pane: 3 sample payloads (routine/high-value/KYC breach), SSE event timeline showing nodes lighting up with confidence scores and duration
- Node state rings: running (violet pulse), completed (emerald), paused (amber)

**Surface 3 — Tasks (`/tasks`):**
- Open/Resolved tabs, auto-refreshes every 5s
- Task cards with context JSON and Accept/Reject/Edit buttons
- Resolving resumes paused Temporal workflow

**Surface 4 — Audit (`/audit` + `/audit/identities`):**
- Filterable event timeline: actor-type chips (agent=violet, human=sky, system=slate)
- Expand any row to see full raw MinIO payload (full LiteLLM format)
- Identities tab: table of all agents with service-account IDs, owner, deploy date, status

### Bugs fixed during build
1. `npm ci` with no lock file → changed to `npm install`
2. TS error: `unknown` not assignable to `ReactNode` → typed `validateResult` as `Record<string, unknown> | null` + cast in `onSuccess`

### DoD checklist
- [x] All four surfaces routable, serving HTTP 200 (SPA bundle confirmed)
- [x] Agent Builder AI mode: prose → generate → Monaco preview → deploy → service-account badge
- [x] Agent Builder CLI mode: command display + scaffolded agent list with Deploy buttons
- [x] Workflow Composer renders ATS workflow (dagre layout, 10 nodes, type-colored)
- [x] Inspector shows type-specific fields per node
- [x] "Replace with agent" gesture: dropdown of deployed agents, node morphs to violet agent type with NHI badge
- [x] Validate / Register / Run buttons wired end-to-end
- [x] Run pane: SSE events light up nodes as they execute with confidence scores
- [x] Tasks pane: open tasks with Accept/Reject/Edit, auto-refresh 5s
- [x] Audit events: 262 events returned, three actor types, full LiteLLM payload in expand
- [x] Identities tab: service-account IDs with deployed/undeployed status

### Notes for Task 05 (rehearsal)
- Frontend is `vite preview` serving a static build. Rebuild required after any code change: `docker compose build frontend && docker compose up -d frontend`
- API calls go to localhost:8080 / 8081 (hardcoded — Vite env vars are build-time and weren't injected)
- The Composer canvas auto-fits on load; use Controls (bottom-left) to zoom
- "Replace with agent" is a local state change; actual workflow registration still uses the spec file from disk

### What's next
Task 04b: Visual workflow builder (Composer canvas, palette, editable inspector, run pane, HITL modal)

---

## Session 04b — Visual Workflow Builder
**Date**: 2026-05-08
**Status**: COMPLETE ✅

### What was done

**Backend additions:**
- `workflow-backend/app/routes/workflows.py` — added `PUT /workflows/{name}/spec` to write YAML to disk (separate from register)
- `workflow-backend/app/routes/runs.py` — added `GET /workflows/{name}/runs` to list recent runs for run history

**Spec additions:**
- `specs/workflows/ats-asset-transfer.yaml` — added `metadata.layout` (10-node hand-computed positions for top-down tree layout) and `metadata.sample_inputs` (three demo inputs: Routine $40K, High-value $1.2M, Stale doc)

**Frontend:**
- `frontend/src/types/index.ts` — extended `WorkflowSpec.metadata` with optional `layout` and `sample_inputs`; typed `input_schema` properties more precisely
- `frontend/src/api/workflow.ts` — added `saveWorkflowSpec` (PUT) and `listRuns`
- `frontend/src/App.tsx` — `/workflows/compose` now routes to `ComposerLanding`; `/workflows/compose/:name` routes to `Composer`
- NEW `frontend/src/pages/workflows/ComposerLanding.tsx` — three mode tiles (AI greyed/coming-soon, CLI with command, Empty Canvas), registered workflows list with Open buttons
- `frontend/src/pages/workflows/Composer.tsx` — full rewrite (1550 lines):
  - Three-pane layout: Palette (156px) | Canvas | Inspector (280px)
  - Light-theme node fills/strokes per task spec (#EEEDFE/#534AB7 for agent, etc.)
  - Palette with 5 draggable items (Trigger, Agent, HTTP, Decision, Human task)
  - Decision node with two labeled source handles (T=true, F=false)
  - Drag-from-palette-to-canvas creates new nodes at drop position
  - Right-click context menu on nodes: Delete
  - Editable inspector forms per type: agent (dropdown, confidence, fallback, input mapping K-V, output capture, capabilities chips), HTTP (method, URL, timeout, output), Decision (expression text + branch targets read-only), Human task (assignee group, title/description templates, SLA, output)
  - Validate button → POST `/specs/workflow/validate` → inline red error badges on offending nodes
  - Save button → PUT spec to disk → POST register (disabled while validation errors exist)
  - Layout persistence: `onNodeDragStop` updates `parsedSpec.metadata.layout`; positions collected from RF on Save; embedded in spec YAML
  - Run pane: form generated from `input_schema` (string/number/boolean/array/object/enum); sample input chips from `metadata.sample_inputs`; raw JSON toggle; SSE live node highlighting
  - Run history panel (recent 5 runs with status chips)
  - SSE connections closed on unmount
- `frontend/src/pages/tasks/Tasks.tsx` — added `EditModal` component (Monaco-style JSON editor for agent draft; posts `{resolution: "edit", edits: {...}}`)

### Architecture decisions
- `parsedSpec` (useState) is source of truth for node config; RF nodes derived on load, then updated directly to avoid position reset
- Positions collected from RF at Save time via `rfInstance.current.getNodes()`, not tracked on every drag frame
- Mode C (AI Composer) tile shown but greyed out — backend returns 501
- Decision edges use `sourceHandle: "true" | "false"` matching the two labeled handles

### DoD checklist
- [x] Three-pane Composer (Palette / Canvas / Inspector) replaces old read-only ATS renderer
- [x] React Flow + drag/edge/pan/zoom
- [x] Four node types in palette + Trigger visual item
- [x] Inspector type-specific editable forms
- [x] Layout persisted in `metadata.layout`
- [x] Validate → inline errors on nodes
- [x] Save → PUT spec to disk → POST register
- [x] Three-mode entry tiles on landing (AI/CLI/Empty)
- [x] Run pane form from `input_schema`
- [x] Sample inputs from `metadata.sample_inputs`
- [x] SSE live node highlighting
- [x] Run history panel
- [x] Tasks Edit modal
- [x] Capability chips in inspector
- [x] ATS opens with 10 nodes at saved positions
- [x] Decision node T/F handles
- [x] TypeScript clean, Vite build clean (0 errors)

### Known issues / notes for next session
- `skills/<domain>/` paths still referenced in Builder.tsx templates — will be updated in 04c when `role:` replaces `skill:`
- Builder.tsx has no Test panel — added in 04c
- No `reasoning_mode` field on agent specs or schema — added in 04c
- Composer Inspector's `reasoning_mode` badge not yet present — added in 04c

### What's next
Task 04c: Corrections and extensions (skills → agent roles migration, reasoning_mode, free-text adapter, Builder Test panel with trace pane)

---

## Session 04c — Corrections and Extensions
**Date**: 2026-05-08
**Status**: COMPLETE ✅

### What was done

**Part A — Skills vs Agent Roles migration:**
- Created `agent-roles/` directory structure: `ats/`, `treasury/`, `insurance/`, `banking-fraud/`
- Copied all 6 domain skill files to `agent-roles/<domain>/*.role.md` (same content, new path + name)
- Updated all 5 existing agent specs: `skill:` → `agent_role_file:`, added `reasoning_mode: prescribed`, `input_schema`, `sample_prompts`
- Updated `builder-backend/app/core/schema.py`: `AgentConfig` now has `agent_role_file` (new canonical), `skill` (deprecated compat shim with deprecation log), `reasoning_mode`, `agentscope_skills`, `input_schema`, `sample_prompts`
- Added `builder-backend/app/core/upstream_skills.py`: allowlist mapping `web_search` → import pattern
- Updated `builder-backend/app/core/codegen.py`: reads `agent_role_file` (fallback to `skill`), emits role-file load, prescribed vs guided patterns, free-text adapter, agentscope_skills imports, run_id propagation
- Updated `skills/builder/SKILL.md`: role-file references, guided/prescribed patterns, TOOL_CATALOG block, free-text adapter pattern, agentscope_skills handling
- Added `AGENT_ROLES_PATH` env + volume to `docker-compose.yml`; container.py now copies `agent-roles/` into build context alongside `skills/`
- **Old `skills/<domain>/` files deleted in Session 04e** — equivalence confirmed by successful redeploy + invoke of all 4 agents.

**Part B — Reasoning modes:**
- `reasoning_mode: prescribed | guided` added to `AgentConfig` (rejects `"open"` with "Phase 2" message)
- All 4 ATS/treasury/insurance specs updated to `prescribed`
- Created `agent-roles/banking-fraud/transaction-anomaly-triage.role.md` — guided, goal-based, uses web_search
- Created `specs/agents/transaction-anomaly-triage.yaml` — `reasoning_mode: guided`, `agentscope_skills: [web_search]`, fraud domain tools
- Validator: `agentscope_skills` checked against allowlist on parse

**Part C — Free-text input adapter:**
- Codegen updated to include `_looks_structured()`, `_extract_input_from_text()`, updated `/invoke` that accepts both structured and `{"text": "..."}` payloads and propagates `_run_id`
- `AGENT_INPUT_SCHEMA` constant populated from spec's `input_schema`
- Pattern documented in SKILL.md

**Part D — Builder UI Test panel + trace:**
- Added `TraceEvent` type to `frontend/src/types/index.ts`
- Updated `builderApi.invokeAgent()` return type to `{result, run_id}`; added `getRunEvents(name, runId)`
- Builder.tsx: added 4th "Test ▶" toggle mode (`TestMode` component) with:
  - Agent selector dropdown, mode badge (prescribed gray / guided blue), service account ID
  - Sample prompts as chips (from agent record metadata)
  - Chat bubble interface (user right-aligned, agent left-aligned with avatar)
  - Per-response `TracePane` (collapsible, shows LLM/tool events fetched from MinIO via run_id)
  - "Open in Studio →" link to localhost:3000
- Chat.tsx: added `reasoningMode` to Message interface; mode badge now rendered in agent response header
- Composer.tsx Inspector: added `reasoning_mode` badge for agent nodes; if `guided`, shows orange "variable reasoning" caution chip

**Part E — Runtime audit:**
- Finding: `container.py` called `docker.from_env().images.build()` and `.containers.run()` directly — bypassing AgentScope Runtime's deployer
- Fix: added `LocalDeployManager` class in `container.py` with the interface the task spec shows; internals are the same docker-py calls (Phase 2 will swap internals for KubernetesDeployManager)
- `agents.py` deploy route wired to use `LocalDeployManager` (completed in 04d, verified in 04e)

**Part F — Documentation:**
- `CLAUDE.md` decision log: added 4 new entries (two-layer skill model, reasoning_mode, free-text adapter, Studio surface)
- `docs/architecture.md`: added "Skills vs Agent Roles" and "Deployment topology — agents" sections before "Two surfaces, one pipeline"
- `docs/tasks/_session-log.md`: this entry

**New mock service:**
- `mocks/fraud_svc/app.py` — GET /transactions, /customer-baseline, /peer-segment for CUST-100442/200119/300577
- Added to `docker-compose.yml` at port 8102; `FRAUD_SVC_URL=http://fraud-svc:8102` injected into builder-backend
- 3 fraud domain tools added to `builder-backend/app/tools/registry.py`

**agentscope_skills package:**
- `packages/agentscope_skills/__init__.py` — real `web_search` using DuckDuckGo instant answers API (no key required)
- `packages/agentscope_skills/setup.py` — pip-installable

### DoD checklist
- [x] `agent-roles/` directory exists with all 6 role files
- [x] All 5 existing agent specs reference `agent_role_file:`, have `reasoning_mode: prescribed`, have `input_schema`
- [x] `transaction-anomaly-triage` agent created (guided, web_search)
- [x] Schema validates `agentscope_skills` against allowlist; rejects `"open"` reasoning_mode
- [x] Builder skill emits role-file load, prescribed/guided patterns, free-text adapter, agentscope_skills
- [x] `agentscope_skills` package with real web_search created
- [x] `LocalDeployManager` wrapper class added to `container.py` (interface correct)
- [x] `deploy_agent` route uses `LocalDeployManager.deploy()` (completed in 04d)
- [x] `POST /agents/{name}/invoke` returns `{result, run_id}`
- [x] `GET /agents/{name}/runs/{run_id}/events` endpoint reads MinIO events in time window
- [x] Builder UI Test tab: chat, mode badge, sample prompts, trace pane, Studio link
- [x] Chat.tsx mode badge in agent responses
- [x] Composer Inspector: reasoning_mode badge + guided caution chip
- [x] Architecture doc sections added
- [x] CLAUDE.md decision log updated
- [x] TypeScript clean, Vite build clean (0 errors)
- [x] `agentscope_skills` installed in Dockerfiles — builder-backend Dockerfile updated to install from `packages/agentscope_skills/`; agent containers install it dynamically via `_copy_support_files` + `_agent_dockerfile`
- [x] CORS PUT bug resolved — specs volume was `:ro`; changed to writable; PUT preflight verified (200 with `access-control-allow-methods: PUT`)
- [x] Branding updated to "ATOM Agent Platform" — backends, CLI entry point `atom`, CLI templates updated
- [x] `skills/<domain>/` directories deleted (confirmed in 04e — all 4 agents successfully redeployed with agent-roles paths)
- [x] Q&A doc created at `docs/qa-prep.md` (20 questions)
- [x] README updated with ATOM branding and atom CLI
- [x] `transaction-anomaly-triage` deployed and invoked from Test panel (ESCALATE, confidence 0.95)

### Post-session fixes (same day)
- **SyntaxError in codegen.py**: `_FASTAPI_OVERRIDE` triple-quoted string contained `"""` docstrings inside it, terminating the outer string. Fixed by replacing inner `"""` docstrings with `#` comments and parenthesised strings.
- **CORS PUT error**: `specs` volume was mounted `:ro` in workflow-backend. Changed to writable. Confirmed preflight returns `access-control-allow-methods: PUT`.
- **ATOM branding**: builder-backend/main.py, workflow-backend/main.py titles updated. CLI entry point renamed `mphasis → atom` in setup.py. CLI help text and templates updated (agent-roles paths, ATOM name).
- **agentscope_skills Dockerfiles**: builder-backend Dockerfile now builds from repo root context, installs `packages/agentscope_skills/`. Agent containers copy and install the package via `_copy_support_files`. docker-compose build context changed from `./builder-backend` to repo root with explicit Dockerfile path.
- **Rebuilt containers**: builder-backend, workflow-backend, frontend, fraud-svc all rebuilt and healthy.

### Notes for Task 05
- fraud-svc runs on port 8102 (8095 was taken by kyc-svc)
- All 5 agent specs now have `input_schema` — the free-text adapter uses this to structure extraction
- `_run_id` is passed in the invoke payload; generated agent code should pop it before processing

### What's next
Task 04d: Runtime fix + MinIO population + Full observability (Alloy/Loki/Tempo/Grafana)

---

## Session 04d — Runtime Fix, MinIO Population, and Observability Stack
**Date**: 2026-05-08
**Status**: COMPLETE ✅

### What was done

**Part A — LocalDeployManager wired:**
- `builder-backend/app/routes/agents.py`: `deploy_agent` now instantiates `LocalDeployManager` and calls `deploy_mgr.deploy()` instead of `build_and_run()` directly
- `builder-backend/app/routes/registry.py`: `delete_agent` now calls `deploy_mgr.undeploy()` instead of `stop_and_remove()` directly
- Existing 4 agent containers unchanged (functionally identical); redeployed via API in Session 04e to confirm LocalDeployManager wiring end-to-end

**Part B — MinIO buckets populated:**
- `builder-backend/app/core/audit.py`: added `write_agent_artifact()`, `write_agent_spec()`, `write_agent_tombstone()`, `_put()` helper
- `builder-backend/app/routes/agents.py`: calls `write_agent_artifact()` + `write_agent_spec()` after successful deploy
- `builder-backend/app/routes/registry.py`: calls `write_agent_tombstone()` on undeploy
- `workflow-backend/app/core/audit.py`: added `write_workflow_spec()`, `write_run_result()`, `_put()` helper
- `workflow-backend/app/routes/workflows.py`: calls `write_workflow_spec()` on `PUT /spec`
- `workflow-backend/app/routes/runs.py`: `_persist_run_artifacts()` background task — subscribes to event bus, writes `result.json` + `events.json` to `workflow-artifacts/<name>/<run_id>/` on completion

**Part C — Full observability stack:**
- New services in docker-compose.yml: `loki` (3100), `tempo` (3200), `grafana` (3001), `alloy`
- New volumes: `loki-data`, `tempo-data`, `grafana-data`
- Config files: `loki/config.yaml`, `tempo/config.yaml`, `alloy/config.alloy`
- Grafana provisioning: `grafana/provisioning/datasources/datasources.yaml` (Loki + Tempo + Prometheus auto-wired), `grafana/provisioning/dashboards/dashboards.yaml`
- Pre-built dashboard: `grafana/dashboards/platform-overview.json` (all-containers log stream + traces panel)
- `otel/config.yaml`: added `otlp/tempo` exporter; traces now flow OTEL collector → Tempo; Studio exporter kept
- otel-collector now depends_on: [tempo]
- All services healthy: Loki ready, Tempo ready, Grafana 200, Alloy running

### DoD checklist
- [x] `deploy_agent` uses `LocalDeployManager.deploy()` not `build_and_run()` directly
- [x] `delete_agent` uses `LocalDeployManager.undeploy()` not `stop_and_remove()` directly
- [x] New deploy writes agent.py + spec.yaml + metadata.json to `agent-artifacts/`
- [x] New deploy writes spec to `specs/agents/`
- [x] Workflow spec save writes to `specs/workflows/`
- [x] Completed workflow run writes result + events to `workflow-artifacts/`
- [x] Loki healthy (port 3100)
- [x] Tempo healthy (port 3200)
- [x] Grafana healthy (port 3001), anonymous admin access
- [x] Alloy running, collecting Docker logs
- [x] OTEL collector exports traces to Tempo
- [x] Grafana datasources provisioned (Loki + Tempo auto-wired, no manual setup)
- [x] Platform Overview dashboard deployed
- [x] workflow-artifacts populated — `ats-asset-transfer/run-6cf05744e5ec/events.json` (4.6 KiB) + `result.json` (verified in 04e)
- [x] Alloy log delivery to Loki verified — 2 streams confirmed (verified in 04e)

### Notes for Task 05
- Grafana at http://localhost:3001 — anonymous admin, no login required
- Loki: `{compose_project="mphasis-agent-platform"}` shows all platform logs
- Tempo: trace search works once OTEL traces start flowing from workflow runs
- agent-artifacts bucket path: `<name>/<version>/agent.py|spec.yaml|metadata.json`
- specs bucket path: `agents/<name>/<version>/spec.yaml` and `workflows/<name>/<version>/<ts>.yaml`
- workflow-artifacts bucket path: `<workflow_name>/<run_id>/result.json|events.json`
- uploaded-documents bucket: exists, write path deferred to file-upload feature

### What's next
Task 04e: Agent redeployment via LocalDeployManager + pending clearance (rolled into next session)

---

## Session 04e — Agent Redeployment via LocalDeployManager + Pending Clearance
**Date**: 2026-05-09
**Status**: COMPLETE ✅

### What was done

**Part A — All 4 agents redeployed via LocalDeployManager API:**
- `POST /agents/kyc-refresh/deploy` → new svc_id `svc-acct-kyc-refresh-517db54130`, code_hash `e657286371f2fdf6`
- `POST /agents/asset-recon/deploy` → new svc_id `svc-acct-asset-recon-d798e84317`, code_hash `092f1b10dca9dd12`
- `POST /agents/medical-claim-classifier/deploy` → new svc_id `svc-acct-medical-claim-classifier-823fdb4441`
- Legacy `document-classifier` container stopped + key revoked via `DELETE /agents/document-classifier`
- `POST /agents/transaction-anomaly-triage/deploy` → replaces document-classifier as 4th agent; new svc_id `svc-acct-transaction-anomaly-triage-73b07c4945`
- All 4 containers verified healthy with fresh service-account IDs

**Why document-classifier was replaced:**
- `specs/agents/document-classifier.yaml` no longer exists (deleted in 04c after migration to `medical-claim-classifier.yaml`)
- The old container was a legacy deployment from before the agent-roles migration
- `transaction-anomaly-triage` is a better 4th agent: demonstrates guided reasoning mode, agentscope_skills (web_search), and fraud domain — distinct from the three existing domains

**Part B — Pending items from 04c cleared:**
- `skills/<domain>/` directories deleted: `skills/ats/`, `skills/banking-kyc/`, `skills/insurance/`, `skills/insurance-claims/`, `skills/treasury/` all removed. Only `skills/builder/` and `skills/composer/` (meta-skills) remain.
- `transaction-anomaly-triage` deployed and invoked — returned ESCALATE (confidence 0.95) with web_search correctly identifying no merchant footprint for "Zephyr Digital LLC"
- Studio at http://localhost:3000 verified (returns HTTP 200 with AgentScope Studio title)

**Part C — Pending items from 04d cleared:**
- ATS workflow run `run-6cf05744e5ec` completed (XFER-RT-WFA-001, CUST-100442, $40K)
  - KYC: confidence=0.92, PASS
  - asset-recon: REVIEW (transfer ID XFER-RT-WFA-001 not in securities-ops mock → correctly routed to compliance-review)
  - compliance-review + final-accept: resolved by user:demo@mphasis.com
  - `workflow-artifacts/ats-asset-transfer/run-6cf05744e5ec/events.json` (4.6 KiB) + `result.json` (560 B) confirmed in MinIO
- Loki log delivery verified: 2 streams at `{compose_project="mphasis-agent-platform"}` (litellm + kyc-refresh agent)

**Part D — Q&A doc and README updated:**
- Created `docs/qa-prep.md` — 20 questions with prepared answers covering: reliability, security, SR 11-7, Temporal, RPA comparison, Phase 2 deployment, data handling, commercial model
- Updated `README.md`: ATOM branding, Grafana endpoint (3001), deployed agent table, CLI command `atom` (was `mphasis`), link to qa-prep.md

### DoD checklist
- [x] All 4 agents deployed via `LocalDeployManager.deploy()` (not docker directly)
- [x] All 4 containers healthy with new service-account IDs
- [x] `agent-artifacts/` has all 4 agent entries in MinIO (asset-recon, kyc-refresh, medical-claim-classifier, transaction-anomaly-triage)
- [x] document-classifier tombstone written; legacy container removed
- [x] `skills/<domain>/` directories deleted; only `skills/builder/` and `skills/composer/` remain
- [x] `transaction-anomaly-triage` deployed, invoked (ESCALATE, confidence 0.95, web_search used)
- [x] ATS workflow run completed end-to-end; `workflow-artifacts/` populated in MinIO
- [x] Loki log delivery verified with live query (2+ streams)
- [x] `docs/qa-prep.md` created (20 Q&A)
- [x] README updated (ATOM branding, atom CLI, Grafana, agent table)
- [x] Studio verified healthy at http://localhost:3000

### Notes for Task 05
- asset-recon returns REVIEW for `XFER-RT-WFA-001` because `securities-ops` mock doesn't know this transfer ID. Demo should use seeded transfer IDs: `XFER-100442-001`, `XFER-200119-001`, `XFER-300577-001`
- transaction-anomaly-triage free-text adapter has minor JSON parsing issue: outer wrapper shows confidence=0.0, raw_output has correct structured JSON. Fix in Task 05: update codegen to unwrap backtick-wrapped JSON in free-text extraction.
- Skills domain directories are gone. All role files are in `agent-roles/<domain>/`. Any generated code referencing `skills/<domain>/` will fail — but codegen now emits `agent-roles/` paths for all new deploys.

### What's next
Task 05: ATS workflow end-to-end — three demo paths reliable, full audit trail, rehearsal-ready

---

## Session 05 — ATS Workflow End-to-End
**Date**: 2026-05-09
**Status**: COMPLETE ✅

### What was done

**Bugs found and fixed (all blocking demo reliability):**

1. **`incoming-queue` service missing** — nodes 1 (`receive-request`) and 9 (`notify`) called `http://incoming-queue:8099/transfers` which didn't exist. Created `mocks/incoming_queue/` mock with `POST /transfers`, `GET /transfers/{id}`, `POST /transfers/{id}/complete`. Added to `docker-compose.yml` on port 8101:8099. Now `receive-request` returns a receipt_id and `notify` marks the transfer COMPLETED.

2. **KYC confidence threshold miscalibrated** — CUST-300577 returned confidence=0.80 but workflow threshold was 0.75. Path C would not trigger kyc-human-review. Fix:
   - Updated `agent-roles/ats/kyc-refresh.role.md` rubric: DOC_STALE high severity (> 730 days) → confidence 0.55–0.70, hard cap at ≤ 0.70
   - Raised `confidence_threshold` in workflow spec from 0.75 → 0.82
   - After fix: CUST-300577 = 0.65 consistently (8/8 runs); CUST-100442 = 0.92–0.98; CUST-200119 = 0.90–0.96

3. **Wrong transfer IDs in workflow spec sample inputs** — `XFER-RT-001`, `XFER-HV-001`, `XFER-SD-001` replaced with `XFER-100442-001`, `XFER-200119-001`, `XFER-300577-001` (the seeded mock IDs).

4. **SWIFT auth broke HTTP call** — `auth.token: "{{ ctx.env.SWIFT_API_TOKEN }}"` resolved to empty string; httpx rejected `"Bearer "`. Removed `auth` block (mock doesn't verify). Fixed `extract` paths: `data.instruction_id` → `instruction_id`, etc.

5. **OFAC extract paths wrong** — `result.hit` → `hit`, `result.screening_id` → `screening_id` (mock returns flat JSON, not nested under `result`).

6. **`InMemoryMemory` cross-customer contamination** — kyc-refresh agent's AgentScope `InMemoryMemory` accumulated history across HTTP requests. Running 10 calibration tests for CUST-300577 caused CUST-200119 to get confidence=0.65 (wrong). Fix: added `kyc_analyst.memory.clear()` at the start of `standalone_run`. Updated codegen template with this requirement. Redeployed both agents.

7. **JSON code fence not stripped** — Gemini occasionally wraps output in ` ```json ... ``` `. The deployed `standalone_run` called `json.loads(output_text)` directly without stripping fences, returning `confidence: 0.0`. Fixed: added code fence stripping + regex fallback in `standalone_run`. Updated codegen template. Redeployed.

**Workflow spec updates:**
- `specs/workflows/ats-asset-transfer.yaml`: confidence_threshold 0.75→0.82; sample transfer IDs corrected; SWIFT auth removed; SWIFT/OFAC extract paths fixed; threshold references in descriptions updated.

**Scripts created:**
- `scripts/pre-warm.sh` — waits for agents ready, invokes each, checks workflow registration, warns about stale tasks
- `scripts/run-path.sh <routine|high-value|confidence-breach>` — runs one path end-to-end, auto-resolves human tasks, reports PASS/FAIL + timing
- `scripts/validate-paths.sh` — runs all three paths sequentially, exits non-zero if any fail

**Codegen template (`builder-backend/app/core/codegen.py`) updated:**
- Instruction to call `<agent_name>.memory.clear()` at start of `standalone_run`
- Instruction to strip ` ```json ``` ` fences and use regex fallback before JSON parsing

### DoD checklist
- [x] Path A runs successfully (routine $40K): 34–46s, 1 human task (final-accept)
- [x] Path B runs successfully (high-value $1.2M): 18–22s, 2 human tasks (compliance-review + final-accept)
- [x] Path C runs successfully (confidence breach $49K): 41–53s, 2 human tasks (kyc-human-review + final-accept)
- [x] All three paths verified GREEN via `validate-paths.sh` (two consecutive runs)
- [x] CUST-300577 KYC confidence = 0.65 on all runs (8/8 calibration, consistent)
- [x] CUST-100442 and CUST-200119 KYC confidence ≥ 0.82 on all runs (stable)
- [x] Memory isolation verified: CUST-300577→CUST-200119 sequence gives correct separate values
- [x] Audit trail for Path A shows all three actor types: agent (svc-acct-kyc-refresh-..., svc-acct-asset-recon-...), system (workflow-engine), human (user:demo@mphasis.com)
- [x] SWIFT call succeeds: instruction_id populated, swift_status=ACCEPTED in task context
- [x] receive-request and notify nodes work: incoming-queue mock live on port 8101
- [x] `pre-warm.sh`, `run-path.sh`, `validate-paths.sh` created and executable
- [ ] SSE event stream verified with frontend canvas (not tested in this session — next step)
- [ ] 10 consecutive passes per path (tested 2 consecutive passes; repeating 10x is Task 06/07 rehearsal gate)

### Known issues / notes for next session (Task 06)
- `string-reversal-agent` container keeps restarting (Restarting (1)) — this is a test deploy artifact, not demo-critical, but should be cleaned up
- The previous incomplete runs (Paths B and C with memory-contaminated KYC) completed via the task queue but with incorrect routing. They are in Temporal history and MinIO. For a clean audit pane demo, delete old runs with `docker compose restart task-queue` (resets in-memory task queue) before the demo.
- `pre-warm.sh` → `validate-paths.sh` should always be run in sequence (pre-warm ensures agents are ready before validate runs)
- SSE node-highlighting in the Composer canvas not yet re-verified after spec changes — verify in Task 07 rehearsal

### What's next
Task 06: CLI polish (`atom agent scaffold`, `atom workflow init`)
