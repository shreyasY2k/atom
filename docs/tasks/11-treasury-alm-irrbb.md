# Session 11 — Treasury ALM/IRRBB Workflow on Atom

**Date**: 2026-05-19  
**Branch**: production  
**Commit**: `4d27f92`  
**Status**: ✅ COMPLETE (all core tasks done; see open items at bottom)

---

## What Was Built

The VAB (Virtual Agentic Bank) ALM/IRRBB pipeline was migrated from UVAB's hardcoded Lobster DSL to a proper Atom Temporal workflow. The existing workflow had no macro-economic context, no historical behavioral data, and no AI-generated recommendations. All of that was added.

**The result**: clicking "Run AI-Driven Analysis" on the VAB UI triggers a 9-node Temporal workflow that collects macro signals, forecasts rates, runs Basel III-compliant IRRBB math on the real portfolio, and generates 5 evidenced hedge recommendations — each backed by historical patterns + macro factors + ALM analytics.

---

## Final Architecture

### Workflow: `treasury-alm-irrbb` (9 nodes, not 12 as originally planned)

```
collect-macro-signals         [agent]       macro_signal: regime, surprise_index, key_indicators
ingest-nlp-sentiment          [agent]       sentiment_signal: H/D index, active behavioral patterns
rate-forecast-modelling       [agent]       forecast_object: 4 scenarios + confidence_score
confidence-gate               [decision]    >0.70 → governance, <0.70 → low-confidence-review
low-confidence-review         [human_task]  Treasurer overlay (low-confidence path only)
governance-treasurer-review   [human_task]  Treasurer approves forecast before ALM analysis
alm-full-suite                [http]        VAB gateway /api/v1/alm/run-suite (all 4 ALM metrics)
alco-intelligence-brief       [agent]       5 hedge recommendations with 3-pillar evidence each
alco-approval                 [human_task]  ALCO per-recommendation individual decisions
```

**Note on design change**: The original plan had 4 separate HTTP nodes for gap/NII/EVE/duration. These were collapsed into one `alm-full-suite` node that calls the VAB gateway's run-suite endpoint (which handles balance sheet extraction from `treasury_instruments` table and runs all 4 compute steps internally). This was simpler and more reliable than passing balance sheet data through node context.

**Task queue**: `treasury-task-queue`  
**Human gates**: 3 (low-confidence overlay, governance review, ALCO approval)  
**External notify**: all human_task nodes notify VAB gateway → real-time Approval Gate updates via WebSocket

### Four AI Agents (deployed, running)

| Agent name | Container | Service account |
|---|---|---|
| `treasury-macro-signal` | `agent-treasury-macro-signal-1-0-0:8100` | `svc-acct-treasury-ma...` |
| `treasury-sentiment-nlp` | `agent-treasury-sentiment-nlp-1-0-0:8100` | `svc-acct-treasury-se...` |
| `treasury-rate-forecast` | `agent-treasury-rate-forecast-1-0-0:8100` | `svc-acct-treasury-ra...` |
| `treasury-alco-intelligence` | `agent-treasury-alco-intelligence-1-0-0:8100` | `svc-acct-treasury-al...` |

All use: `gemini-3.1-pro`, `temperature: 1.0`, `reasoning_effort: high` (ALCO), `medium` (others)

### 10 Tools (registered via API, not hardcoded in registry.py)

**VAB compute tools** (call `http://host.docker.internal:3030`):
- `run_gap_analysis` — repricing gap, 8 tenor buckets
- `run_nii_simulation` — NII-at-Risk across 6 rate-shock scenarios
- `run_eve_sensitivity` — ΔEVE under Basel III IRRBB shocks
- `run_duration_equity` — Duration of Equity formula
- `run_irrbb_suite` — all 4 above in one call (used by ALCO agent)

**VAB data tools** (call `http://host.docker.internal:13000`):
- `get_treasury_instruments` — 50-instrument master portfolio DB
- `get_historical_timeseries` — quarterly snapshots across 4 scenarios
- `get_macro_factors` — 11 macro indicators with AI weights
- `get_behavioral_patterns` — BP-001 to BP-012 behavioral patterns
- `store_alco_recommendations` — stores 5 recs for VAB frontend

### UVAB Postgres Data (seeded via migrations 014 + 015)

**Migration 014** (seeded Treasury AI PoC Database from Excel):
- `treasury_instruments` — 50 instruments (CFG-0001 to CFG-0050)
- `treasury_macro_factors` — 11 macro indicators
- `treasury_regulatory_factors` — 7 regulatory factors
- `treasury_behavioral_patterns` — BP-001 to BP-012
- `treasury_historical_timeseries` — 40 historical rows (10 instruments × 4 scenarios)
- `atom_alco_recommendations` — output sink for ALCO intelligence agent

**Migration 015** (bank profiles for scenario simulation):
- Added `bank_profile` column to `treasury_instruments`
- Seeded **community_bank** profile — 17 instruments, $2.1B (CMB-0001 to CMB-0017)
- Seeded **large_bank** profile — 18 instruments, $45B (LGB-0001 to LGB-0018)
- **regional_bank** (existing 50 instruments, $13.2B) is the default

---

## File Inventory

### Atom repo (this repo)

| File | Purpose |
|---|---|
| `specs/workflows/treasury-alm-irrbb.yaml` | 9-node workflow spec, task_queue=treasury-task-queue |
| `specs/agents/treasury-macro-signal.yaml` | Agent spec — prescribed, get_macro_factors + get_treasury_instruments |
| `specs/agents/treasury-sentiment-nlp.yaml` | Agent spec — guided, get_macro_factors + get_behavioral_patterns |
| `specs/agents/treasury-rate-forecast.yaml` | Agent spec — prescribed, get_macro_factors + get_behavioral_patterns |
| `specs/agents/treasury-alco-intelligence.yaml` | Agent spec — guided, all 6 tools, max_iterations=10 |
| `agent-roles/treasury/macro-signal-collector.role.md` | Prescribed role: reads macro DB → MacroSignalObject |
| `agent-roles/treasury/sentiment-nlp-agent.role.md` | Guided role: H/D scoring → SentimentSignalObject |
| `agent-roles/treasury/rate-forecast-agent.role.md` | Prescribed role: Taylor Rule → ForecastObject + confidence_score |
| `agent-roles/treasury/alco-intelligence-agent.role.md` | Guided role: synthesises all → exactly 5 recommendations, JSON only |
| `scripts/register_treasury_workflow.py` | Re-runnable: creates tools, deploys agents, registers workflow |
| `builder-backend/app/core/codegen.py` | Fix: `output_text = output_text or ""` (None-safe); JSON array extraction |
| `workflow-backend/app/worker/runner.py` | Fixes: env. template resolution, default() filter, external_notify_url, ctx._run_id, input unwrap |
| `workflow-backend/app/routes/runs.py` | Fix: unwrap payload.input correctly (was double-nested) |
| `workflow-backend/app/worker/activities.py` | Feature: external_notify_url on human_task creates → real-time VAB UI updates |
| `workflow-backend/app/core/schema.py` | Feature: WorkflowNode.external_notify_url optional field |
| `workflow-backend/app/main.py` | Feature: dual Temporal workers (ats-task-queue + treasury-task-queue) |
| `docker-compose.yml` | Feature: UVAB_GATEWAY_URL + UVAB_COMPUTE_URL env vars for builder/workflow backends |
| `docs/vab-demo-runbook.md` | Complete demo runbook — pre-cleanup, 3 profiles, 5 shocks, walkthrough, troubleshooting |
| `docs/tasks/11-treasury-alm-irrbb.md` | This file |

### VAB repo (commit separately)

| File | Purpose |
|---|---|
| `migrations/014_treasury_ai_poc_data.sql` | Seed treasury data tables from Excel |
| `migrations/015_bank_profiles.sql` | 3 bank profiles (community, regional, large) |
| `infra/Dockerfile.{gateway,agents,compute,workflow-engine,adapters,ui}` | Build from source |
| `infra/docker-compose.yml` | Build directives, atom-uvab network, ATOM_WORKFLOW_URL |
| `services/gateway/src/app.ts` | 9 new endpoints + bank_profile + scenario shock support |
| `apps/ui/src/app/page.tsx` | Full UI redesign: 4 tabs, Atom workflow wiring, Kanban, real-time events |
| `apps/ui/src/components/RecommendationCard.tsx` | 3-pillar evidence cards with VAB CSS variables |
| `apps/ui/src/components/AtomTaskPanel.tsx` | Per-recommendation individual approve/reject |
| `apps/ui/src/components/AtomTaskPanel.tsx` | Filter by currentRunId; clears on resolve |
| `apps/ui/src/app/api/atom/` | Next.js server-side proxy routes (no CORS) |
| `apps/ui/src/lib/stores/recommendations.ts` | Zustand store for ALCO recs; uses relative URLs |
| `apps/ui/src/lib/stores/alm.ts` | loadAlmData(bankProfile, scenarioProfile) signature |

---

## Key Design Decisions Made

### 1. Collapsed 4 ALM http nodes → 1 `alm-full-suite` node

**Why**: The 4 individual ALM nodes needed `assets`/`liabilities` arrays from the governance approval context, but the human task only returns `{resolution, resolved_by, edits}`. Rather than re-architect the context flow, the `alm-full-suite` node calls VAB's `/api/v1/alm/run-suite` which handles balance sheet extraction from `treasury_instruments` table internally.

### 2. Tools registered via API, not in registry.py

Per user requirement: tools are in the Atom platform DB, not hardcoded. The `scripts/register_treasury_workflow.py` script creates them via `POST /tools`. Registry.py remains unchanged.

### 3. `external_notify_url` is node-level, not global env var

Each human_task node specifies where to notify. This allows different workflows to notify different external systems. The treasury workflow notifies `http://host.docker.internal:13000/api/v1/atom/tasks/notify`.

### 4. Template resolution fix (`{{ ctx.input.scenario_profile }}`)

Root cause: the workflow was started with `{"input": {"run_date": ..., "scenario_profile": ...}}` as the payload. The `runs.py` route stored `payload` (the entire body) as `args["input"]`, causing double-nesting: `ctx["input"] = {"input": {"run_date": ...}}`. Fixed by `payload.get("input", payload)`.

### 5. `output_text = output_text or ""` in codegen

Root cause: when an agent makes multiple tool calls and the LLM returns only tool results with no final text message, `response.get_text_content()` returns `None`. The generated `standalone_run` then crashed on `.strip()`. Fixed in the codegen template so all future deployed agents are safe.

---

## Agent Prompts, Tools, and Specs (Verbatim)

This section documents every agent's exact system prompt, tool selection policy, and YAML spec so the setup can be reproduced on a fresh environment. These are the **actual deployed prompts** — not summaries.

---

### Agent 1: `treasury-macro-signal`

**Workflow position**: Node 1 (collect-macro-signals)  
**Pipeline role**: IRR Agent 1 — Macro Signal Collection  
**Container**: `agent-treasury-macro-signal-1-0-0:8100`

#### Spec (`specs/agents/treasury-macro-signal.yaml`)

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment
metadata:
  name: treasury-macro-signal
  domain: treasury-alm
  version: 1.0.0
  description: >
    Treasury ALM IRRBB pipeline — Step 1: Macro Signal Collection.
    Collects, normalises, and interprets macro-economic indicators and regulatory
    factors. Classifies the rate regime, computes a macro surprise index, identifies
    key rate drivers, and produces a structured MacroSignalObject.
  owner: atom-platform-team
spec:
  agents:
  - name: macro-signal-collector
    role: standalone
    agent_role_file: agent-roles/treasury/macro-signal-collector.role.md
    reasoning_mode: prescribed
    model: gemini-3.1-pro
    temperature: 1.0
    reasoning_effort: medium
    max_iterations: 4
    tools:
    - get_macro_factors
    - get_treasury_instruments
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/treasury-macro-signal
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1
```

#### Tools selected

| Tool | Endpoint | Why selected |
|---|---|---|
| `get_macro_factors` | `GET http://host.docker.internal:13000/api/v1/treasury/macro-factors` | Reads 11 macro indicators (Fed Funds, 10Y UST, SOFR, CPI, GDP, VIX, etc.) with AI weights and impact signals |
| `get_treasury_instruments` | `GET http://host.docker.internal:13000/api/v1/treasury/instruments` | Reads portfolio to identify which instruments are most sensitive to rate moves |

#### System prompt (`agent-roles/treasury/macro-signal-collector.role.md`)

> You are the Treasury Research Analyst responsible for the first step of the IRR forecasting pipeline. You collect, normalise, and interpret macro-economic indicators and regulatory factors to produce a structured `MacroSignalObject` that drives the rest of the pipeline.
>
> **Reasoning Mode: prescribed**. Follow these 6 steps strictly in order:
> 1. Call `get_macro_factors()` — retrieve all macro indicators with weights
> 2. Classify rate regime: EASING if Fed Funds "Decreasing" AND 2Y-10Y spread "Improving"; TIGHTENING if Fed Funds "Increasing"; FLAT otherwise
> 3. Compute surprise index for each indicator (|current - prior| / typical_range). Flag if >1.5σ equivalent
> 4. Identify top 3 indicators by AI weight
> 5. Check alert flags on High/Very High sensitivity indicators
> 6. Return `MacroSignalObject` JSON only — no prose

**Output contract**: `{regime, surprise_index, key_indicators[], rate_direction, fed_funds_rate, ten_year_ust, sofr_rate, yield_curve_shape, inflation_trajectory, confidence, alert_flags[], regulatory_watch[], model_run_id}`

**Verification checklist** (agent checks before responding):
- Did I call `get_macro_factors()` before any analysis?
- Did I classify regime from Fed Funds direction, not inference?
- Did I compute surprise index for each available indicator?
- Did I identify top 3 by AI weight from returned data?
- Is output exactly MacroSignalObject structure?

---

### Agent 2: `treasury-sentiment-nlp`

**Workflow position**: Node 2 (ingest-nlp-sentiment)  
**Pipeline role**: IRR Agent 2 — Sentiment & NLP Ingestion  
**Container**: `agent-treasury-sentiment-nlp-1-0-0:8100`

#### Spec (`specs/agents/treasury-sentiment-nlp.yaml`)

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment
metadata:
  name: treasury-sentiment-nlp
  domain: treasury-alm
  version: 1.0.0
  description: >
    Treasury ALM IRRBB pipeline — Step 2: Sentiment & NLP Ingestion.
    Converts a MacroSignalObject into a Hawkish/Dovish sentiment index.
    Detects regime shifts and overlays behavioral pattern data.
  owner: atom-platform-team
spec:
  agents:
  - name: sentiment-nlp-agent
    role: standalone
    agent_role_file: agent-roles/treasury/sentiment-nlp-agent.role.md
    reasoning_mode: guided
    model: gemini-3.1-pro
    temperature: 1.0
    reasoning_effort: medium
    max_iterations: 4
    tools:
    - get_macro_factors
    - get_behavioral_patterns
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/treasury-sentiment-nlp
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1
```

#### Tools selected

| Tool | Endpoint | Why selected |
|---|---|---|
| `get_macro_factors` | `GET .../api/v1/treasury/macro-factors` | Gets current indicator values to anchor sentiment scoring |
| `get_behavioral_patterns` | `GET .../api/v1/treasury/behavioral-patterns` | Gets BP-001–BP-012 patterns to identify which behavioral dynamics are active in current regime |

#### System prompt (`agent-roles/treasury/sentiment-nlp-agent.role.md`)

> You are the Quant/NLP Data Engineer responsible for converting macro signals into a Hawkish/Dovish (H/D) sentiment index.
>
> **Reasoning Mode: guided**. Use your judgment to weigh signals. The H/D index should reflect net directional pressure:
> - H/D index: positive = hawkish, negative = dovish. Range: -1.0 to +1.0
> - EASING regime → start with negative bias (-0.3 to -0.7 depending on magnitude)
> - TIGHTENING regime → start with positive bias (+0.3 to +0.7)
> - Adjust based on: yield curve shape, inflation trajectory, active behavioral patterns
> - Divergence score = disagreement between 7d and 30d signals
> - Document reasoning chain in `narrative_signals`

**Output contract**: `{hd_index_7d, hd_index_30d, regime_flag, uncertainty_flag, divergence_score, active_behavioral_patterns[], narrative_signals[], sentiment_confidence}`

---

### Agent 3: `treasury-rate-forecast`

**Workflow position**: Node 3 (rate-forecast-modelling)  
**Pipeline role**: IRR Agent 3 — Rate Forecast Modelling  
**Container**: `agent-treasury-rate-forecast-1-0-0:8100`

#### Spec (`specs/agents/treasury-rate-forecast.yaml`)

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment
metadata:
  name: treasury-rate-forecast
  domain: treasury-alm
  version: 1.0.0
  description: >
    Treasury ALM IRRBB pipeline — Step 3: Rate Forecast Modelling.
    Applies Taylor Rule + H/D sentiment to generate 4-scenario rate forecast.
    Routes to governance if confidence > 0.70.
  owner: atom-platform-team
spec:
  agents:
  - name: rate-forecast-agent
    role: standalone
    agent_role_file: agent-roles/treasury/rate-forecast-agent.role.md
    reasoning_mode: prescribed
    model: gemini-3.1-pro
    temperature: 1.0
    reasoning_effort: high
    max_iterations: 6
    tools:
    - get_macro_factors
    - get_behavioral_patterns
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/treasury-rate-forecast
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1
```

#### Tools selected

| Tool | Why selected |
|---|---|
| `get_macro_factors` | Gets current rates for Taylor Rule calibration (Fed Funds, SOFR, 10Y UST as OIS proxy for divergence check) |
| `get_behavioral_patterns` | Checks if any active patterns (e.g. BP-008 yield curve inversion, BP-003 deposit beta shift) modify scenario probabilities |

#### System prompt (`agent-roles/treasury/rate-forecast-agent.role.md`)

> You are the ALM Quant/Economist responsible for generating a calibrated 4-scenario interest rate forecast.
>
> **Reasoning Mode: prescribed**. 9-step process:
> 1. Call `get_macro_factors()` for Taylor Rule calibration
> 2. Apply Taylor Rule: assess if current FF is above/below neutral
> 3. Overlay H/D sentiment to adjust scenario probabilities
> 4. Call `get_behavioral_patterns()` for any probability-modifying patterns
> 5. Generate exactly 4 scenarios (Base/Hike/Cut/Pause) — probabilities MUST sum to 1.0
> 6. Compute 3-pillar composite: Pillar1 (DB signals, 25%), Pillar2 (Macro, 30%), Pillar3 (Regulatory, 25%)
> 7. Set confidence_score = composite_score × accuracy factor
> 8. Check divergence (>30bps from SOFR as OIS proxy)
> 9. Return ForecastObject

**Three-Pillar weighting** (from AI Model Architecture data):
- Pillar 1 DB signals: DB-S02 Duration Gap (Critical 25%), DB-S04 DV01 limit (Critical 20%), DB-S01 Concentration (High 20%)
- Pillar 2 Macro: ME-S01 Rate Regime (Critical 30%), ME-S02 Yield Curve (High 20%), ME-S05 Liquidity (High 15%)
- Pillar 3 Regulatory: QR-S01 Capital Headroom (Critical 35%), QR-S03 ALCO Compliance (Critical 25%), QR-S02 Model Risk (High 20%)

**Output contract**: `{scenarios[4], base_sofr, base_10y_ust, weighted_signal_composite{pillar1_score, pillar2_score, pillar3_score, composite_score, dominant_driver}, confidence_score, divergence_flag, divergence_bps, model_run_id}`

---

### Agent 4: `treasury-alco-intelligence`

**Workflow position**: Node 8 (alco-intelligence-brief)  
**Pipeline role**: ALM Agents 5+6 — ALCO Intelligence & Recommendations  
**Container**: `agent-treasury-alco-intelligence-1-0-0:8100`

#### Spec (`specs/agents/treasury-alco-intelligence.yaml`)

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment
metadata:
  name: treasury-alco-intelligence
  domain: treasury-alm
  version: 1.0.0
  description: >
    Treasury ALM IRRBB pipeline — Step 4: ALCO Intelligence & Recommendations.
    Synthesises IRR forecast + live ALM results into exactly 5 hedge
    recommendations with 3-pillar evidence (historical, macro, analytical).
    Stores recommendations before returning.
  owner: atom-platform-team
spec:
  agents:
  - name: alco-intelligence-agent
    role: standalone
    agent_role_file: agent-roles/treasury/alco-intelligence-agent.role.md
    reasoning_mode: guided
    model: gemini-3.1-pro
    temperature: 1.0
    reasoning_effort: high
    max_iterations: 10
    tools:
    - get_treasury_instruments
    - get_historical_timeseries
    - get_macro_factors
    - get_behavioral_patterns
    - run_irrbb_suite
    - store_alco_recommendations
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/treasury-alco-intelligence
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1
```

#### Tools selected

| Tool | Endpoint | Why selected |
|---|---|---|
| `get_treasury_instruments` | `GET .../api/v1/treasury/instruments` | Gets the 50-instrument portfolio so recommendations cite real CFG-XXXX IDs |
| `get_historical_timeseries` | `GET .../api/v1/treasury/timeseries` | Gets 20 quarters × 4 scenarios of historical data per instrument |
| `get_macro_factors` | `GET .../api/v1/treasury/macro-factors` | Gets current macro environment for macro_factor pillar |
| `get_behavioral_patterns` | `GET .../api/v1/treasury/behavioral-patterns` | Gets BP-001–BP-012 patterns for historical_insight pillar |
| `run_irrbb_suite` | `POST http://host.docker.internal:3030/alm/irrbb-suite` | Gets FRESH ALM numbers (gap, NII, EVE, duration) for analytical_factor pillar |
| `store_alco_recommendations` | `POST http://host.docker.internal:13000/api/v1/atom/workflow/results` | Stores the 5 recommendations in VAB gateway DB so frontend can display them |

#### System prompt (`agent-roles/treasury/alco-intelligence-agent.role.md`)

**Critical rules** (must all be satisfied):
1. ALWAYS produce EXACTLY 5 recommendations
2. Each cites a real BP-XXX pattern from `get_behavioral_patterns()` response
3. Each cites a real CFG-XXXX instrument from `get_treasury_instruments()` response
4. Call `run_irrbb_suite()` for fresh ALM numbers
5. `store_alco_recommendations()` MUST be the final tool call before responding
6. Recommendations prioritised P1–P5 by regulatory urgency (EVE > NII > Duration > DV01 > Concentration)

**3-Pillar evidence structure** (mandatory for each recommendation):
- `historical_insight`: "BP-XXX: [Pattern Name] — [historical instances, magnitude, confidence score from ML model]"
- `macro_factor`: "[Named indicator] at [current value], [direction], [AI weight]% weight — [why this drives this recommendation]"
- `analytical_factor`: "[Gap/NII/EVE/Duration] = [value], [vs threshold], [breach status] — [portfolio impact]"

**Output contract** (6 required fields per recommendation):
`{priority, instrument, action, historical_insight, macro_factor, analytical_factor, estimated_pl_impact, risk_reduction_pct, confidence_score, action_owner, timeline, status: "PENDING_APPROVAL"}`

**⚠ MANDATORY FINAL RESPONSE FORMAT**: The ENTIRE response after tool calls must be a single valid JSON array starting with `[` and ending with `]`. No prose, no markdown, no code fences. Must be parseable by `json.loads()`.

This JSON enforcement is critical — the agent has a known tendency to return markdown narrative. The role file ends with explicit instruction to output ONLY the JSON array. This was patched multiple times during development; if the agent returns markdown again, redeploy with the role file in `agent-roles/treasury/alco-intelligence-agent.role.md` (currently 114 lines including JSON enforcement).

---

### How the agents were created

All 4 agents were created through the Atom Builder API (`POST /agents/{name}/deploy`) with the spec YAML and role file content passed as `skill_content`. The codegen (Gemini 3.1 Pro) generates the `agent.py` from the spec. Key codegen constraints applied:

1. `output_text = output_text or ""` guard (prevents NoneType.strip() crash when LLM returns tool-only responses)
2. JSON array extraction tries `\[.*\]` before `\{.*\}` (handles recommendation list format)
3. Role file is loaded at runtime from `/app/agent-roles/treasury/*.role.md` inside the container

Re-registration command:
```bash
python3 scripts/register_treasury_workflow.py
```

This script:
1. Creates all 10 tools via `POST /tools` (5 compute + 5 data)
2. Deploys all 4 agents via `POST /agents/{name}/deploy` with spec + role content
3. Associates tools with agents via `POST /agents/{name}/tools/associate`
4. Registers the workflow via `POST /workflows/treasury-alm-irrbb/register`

---

## Registration Commands

To re-register from scratch on a new setup:

```bash
# From atom/ repo root
python3 scripts/register_treasury_workflow.py

# Verify
curl http://localhost:8082/workflows/treasury-alm-irrbb
curl http://localhost:8080/tools | python3 -c "import json,sys; tools=json.load(sys.stdin)['tools']; [print(t['name'],t['endpoint']) for t in tools if 'uvab' in t.get('endpoint','') or 'host.docker.internal' in t.get('endpoint','')]"
```

---

## Open Items (not done, follow-up sessions)

| Item | Priority | Notes |
|---|---|---|
| Historical timeseries — full 260 rows from Excel Sheet 2 | Medium | Table created, schema correct, only 40 rows seeded (10 instruments × 4 scenarios). Sheet 2 has 260 rows. |
| Bank profiles — additional historical data per profile | Medium | CMB-* and LGB-* profiles seeded with minimal historical data. Richer historical data would improve recommendation quality. |
| Wire UVAB balance sheet extraction to scenario shocks in real-time charts | Low | Charts update on scenario change but use VAB's scenario-inject path, not the Atom workflow. |
| ALCO agent — force JSON via Gemini `response_mime_type` | Medium | Currently relies on role file instructions. Setting `response_mime_type: "application/json"` in the LLM call would be more reliable. |
| Workflow Kanban — MinIO-based polling currently empty | Low | MinIO audit events take time to appear. Event-driven Kanban via WebSocket works, but node-level timestamps only show after completion. |
| Atom Composer — render treasury workflow in drag-drop canvas | Low | The spec is valid and registered. The Composer should be able to render it. Not tested. |
| ALCO recommendations — scenario delta comparison | Medium | Show how P1–P5 change between base vs +200bps scenarios side-by-side. |

---

## DoD Checklist

- [x] Workflow spec validated (`POST /specs/workflow/validate` → valid: true, node_count: 9)
- [x] Workflow registered (spec_hash: `a83ef3df61660c36`, task_queue: treasury-task-queue)
- [x] All 4 agents deployed with service accounts and endpoints
- [x] All 10 tools registered via API with correct endpoints
- [x] Migration 014 seeded: 50 instruments, 11 macro factors, 12 behavioral patterns
- [x] Migration 015 seeded: 3 bank profiles (community $2.1B, regional $13.2B, large $45B)
- [x] VAB UI redesigned: 4-tab layout, bank profile selector, 5 shock scenarios
- [x] Gap table numbers formatted: $1.79B not 1785000000
- [x] Approval Gate shows Atom human tasks in real time via WebSocket
- [x] Per-recommendation individual approve/reject in ALCO approval gate
- [x] Templates resolve correctly in task titles (ctx.input.scenario_profile → "base")
- [x] ALCO agent returns JSON (enforced via role file instructions + codegen fix)
- [x] Kanban advances on WebSocket ATOM_HUMAN_TASK_PENDING events
- [x] `atomRunId` persists in localStorage across tab switches and page refresh
- [x] Stale tasks filtered by currentRunId — no phantom approvals
- [x] Codegen None-safe guard deployed — all future agents safe from NoneType.strip() crash
- [x] Demo runbook written (`docs/vab-demo-runbook.md`)
- [x] Session log updated (`docs/tasks/_session-log.md`)
- [x] Code committed to `production` branch (`4d27f92`)
- [ ] VAB repo committed separately (per user request)
- [ ] End-to-end test from fresh Atom setup (register_treasury_workflow.py → full run → 5 recs)
