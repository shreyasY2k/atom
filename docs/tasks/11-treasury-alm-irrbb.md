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

## Codegen Agent Prompts

### macro-signal-collector.role.md

**System prompt injected**: See `agent-roles/treasury/macro-signal-collector.role.md`

Key constraints: prescribed reasoning, 6-step process, calls `get_macro_factors()` first, classifies regime from Fed Funds + 10Y UST direction, returns `MacroSignalObject` JSON only.

### sentiment-nlp-agent.role.md

**System prompt injected**: See `agent-roles/treasury/sentiment-nlp-agent.role.md`

Key constraints: guided reasoning, takes MacroSignalObject as input, calls `get_behavioral_patterns()`, produces H/D index (-1.0 to +1.0), `SentimentSignalObject` JSON only.

### rate-forecast-agent.role.md

**System prompt injected**: See `agent-roles/treasury/rate-forecast-agent.role.md`

Key constraints: prescribed, 9-step process, Taylor Rule calibration, overlays H/D sentiment, exactly 4 scenarios (Base/Hike/Cut/Pause) summing to probability 1.0, 3-pillar composite score, flags divergence if >30bps from market OIS.

### alco-intelligence-agent.role.md

**System prompt injected**: See `agent-roles/treasury/alco-intelligence-agent.role.md`

Key constraints: guided, MUST call all 4 data tools, MUST produce exactly 5 recommendations (P1–P5), each with `historical_insight` (specific BP-XXX), `macro_factor` (specific named indicator), `analytical_factor` (specific ALM metric), MUST call `store_alco_recommendations()` as final action, FINAL RESPONSE MUST BE JSON ARRAY ONLY (no prose, no markdown).

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
