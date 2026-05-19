# Session 11 — Treasury ALM/IRRBB Workflow

**Date**: 2026-05-19  
**Branch**: production

---

## Problem Statement

The UVAB treasury use case is the second flagship depth demonstration on the Atom platform (alongside ATS). The process exists today as a 9-agent human-driven pipeline inside UVAB's Treasury team. Two problems need solving:

1. **Routine agent work is manual** — five IRR steps (macro data collection, NLP scoring, rate forecast modelling, confidence check, governance prep) and four ALM computation steps (gap analysis, NII simulation, EVE computation, duration analysis) are performed by humans pulling data, running spreadsheets, and writing briefs. Each ALCO cycle takes 3–4 days.

2. **No audit trail** — forecast approvals, human overlays, and hedge decisions live in email threads and meeting notes. There is no single timeline showing who decided what, with what confidence, backed by which data.

The goal for this session: implement the full Treasury ALM/IRRBB pipeline as an Atom workflow spec, create the four AI agents that drive it, wire them to the UVAB compute service (ALM analysis tools), and render the workflow in the Atom Workflow Composer with a running demo.

---

## Architecture Summary

### Workflow: `treasury-alm-irrbb` (12 nodes)

```
collect-macro-signals         [agent]       IRR Agent 1 — macro data + regime classification
ingest-nlp-sentiment          [agent]       IRR Agent 2 — hawkish/dovish scoring
rate-forecast-modelling       [agent]       IRR Agent 3 — Taylor Rule + 4-scenario rate tree
confidence-gate               [decision]    IRR Gate — >70% proceeds, <70% → overlay
low-confidence-review         [human_task]  Treasurer qualitative overlay (on low-confidence path)
governance-treasurer-review   [human_task]  Treasurer approves forecast before ALM analysis
gap-analysis                  [http]        ALM Agent 1 — repricing gap, 8 tenor buckets
nii-simulation                [http]        ALM Agent 3 — NII-at-Risk across 6 shock scenarios
eve-sensitivity               [http]        ALM Agent 4 — ΔEVE under 6 Basel III IRRBB shocks
duration-equity               [http]        ALM Agent 2 — Duration of Equity + convexity
alco-intelligence-brief       [agent]       ALM Agents 5+6 — 5 hedge recommendations, 3-pillar evidence
alco-approval                 [human_task]  ALCO final approval — routes to execution teams
```

**Node type distribution:** 4 agent, 4 http, 3 human_task, 1 decision  
**Human gates:** 3 (low-confidence overlay, governance review, ALCO approval)  
**State-changing calls:** gap/NII/EVE/duration all call UVAB compute service — all gated behind Treasurer approval at Step 6  
**Task queue:** `treasury-task-queue`

### Four AI Agents

| Agent | Domain | Reasoning Mode | Key output |
|---|---|---|---|
| `treasury-macro-signal` | treasury-alm | prescribed | macro_signal (regime, surprise index, rate drivers) |
| `treasury-sentiment-nlp` | treasury-alm | prescribed | sentiment_signal (H/D scores, behavioral patterns) |
| `treasury-rate-forecast` | treasury-alm | prescribed | forecast_object (4 scenarios, weights, confidence_score) |
| `treasury-alco-intelligence` | treasury-alm | guided | alco_recommendations (5 hedges, 3-pillar evidence each) |

### UVAB Compute Service (mock at `http://uvab-compute:3030`)

Four ALM endpoints called by http nodes:
- `POST /alm/gap-analysis` — returns gaps, breach_flag, repricing_summary
- `POST /alm/nii-simulation` — returns nii_at_risk, regulatory_breach_flag, breach_scenarios
- `POST /alm/eve-sensitivity` — returns delta_eve, regulatory_breach_flag, headroom_pct
- `POST /alm/duration-of-equity` — returns duration_of_equity, duration_gap, convexity, breach_flag

### Three Demo Paths

| Path | Trigger | Key branch | Expected outcome |
|---|---|---|---|
| Base EASING cycle | ALCO_TRIGGER | confidence ≥ 70% → governance | 5 recommendations; EVE breach P1 IRS hedge |
| Low confidence overlay | MANUAL, force_low_confidence=true | confidence < 70% → Treasurer overlay | Human overlay adjusts forecast before ALM |
| Rate shock +200bps | BALANCE_SHEET_CHANGE | confidence ≥ 70% → governance | EVE + NII breaches; compound risk alert; 5 urgent hedges |

---

## Tasks

### T1 — Workflow spec: `treasury-alm-irrbb.yaml`

**File**: `specs/workflows/treasury-alm-irrbb.yaml`

Write the full 12-node `atom.platform/v1` WorkflowDeployment spec. Match the ATS spec format exactly: `apiVersion`, `metadata` (name, domain, version, description, owner, layout, sample_inputs), `spec` (input_schema, error_handler, nodes, audit, deployment, triggers, demo_paths).

**Node attribute requirements:**
- agent nodes: `agent_ref.name`, `agent_ref.version`, `input_mapping` (bare ctx expressions), `output_capture`, `timeout_seconds`, `retry`, `on_error`, `tags`, `next`
- http nodes: `method`, `url_template` (with `env.UVAB_COMPUTE_URL | default(...)` fallback), `body_template`, `extract` (flat field names), `output_capture`, `timeout_seconds`, `retry`, `on_error`, `tags`, `next`
- decision node: `cases` list (condition, target, label), `default`, `tags`
- human_task nodes: `assignee_group`, `task_template` (title, description with template vars, actions list), `sla_seconds`, `priority`, `evidence`, `escalation_policy`, `output_capture`, `tags`, `next`

**Layout**: hand-computed y-positions at 140px increments. Low-confidence branch node offset to x:600.

**Triggers**: manual (ALCO Trigger), schedule (monthly ALCO, `0 6 1 * *`), event (BALANCE_SHEET_CHANGE, change_pct > 5).

**Completion criteria:**
- [ ] `POST /specs/workflow/validate` returns VALID, 12 nodes, queue=treasury-task-queue
- [ ] `POST /specs/workflow/validate` with a state-changing http node without adjacent human_task returns BFSI invariant error (use spec validator's existing BFSI path-walk)
- [ ] All three demo_paths in the spec match the node IDs in the nodes list
- [ ] Spec can be saved and registered via Workflow Composer UI

---

### T2 — Agent role file: `treasury-macro-signal`

**File**: `agent-roles/treasury/treasury-macro-signal.role.md`

**Verbatim role file content:**

```markdown
# Role: Treasury Macro Signal Analyst

## Purpose
Collect macro-economic indicators, compute a composite surprise index, classify
the current rate regime, and identify the key rate drivers for the current run date.

## Inputs
- `run_date` (string, ISO YYYY-MM-DD): the date for which to collect signals
- `scenario_profile` (string): base | rate_shock_200bps | rate_shock_300bps | credit_stress | liquidity_crunch

## Output schema (JSON)
```json
{
  "regime": "EASING | TIGHTENING | FLAT",
  "surprise_index": <float, -1.0 to 1.0>,
  "rate_drivers": [{"factor": str, "direction": "up|down|neutral", "weight": float}],
  "macro_indicators": {
    "fed_funds_rate": float,
    "cpi_yoy": float,
    "gdp_growth": float,
    "unemployment": float,
    "10y_yield": float,
    "yield_curve_slope": float
  },
  "run_date": str,
  "scenario_profile": str,
  "confidence": float
}
```

## Reasoning mode: prescribed

Follow these steps strictly in order. Do not skip, reorder, or add steps.

1. **Retrieve macro indicators** for run_date using the `get_macro_indicators` tool.
2. **Compute surprise index**: compare each indicator to consensus estimate using `compute_surprise_index`.
3. **Classify regime**: EASING if fed_funds_rate falling AND yield_curve_slope < 0.5; TIGHTENING if fed_funds_rate rising AND yield_curve_slope > 1.0; FLAT otherwise. Apply scenario_profile overrides.
4. **Identify rate drivers**: rank top-3 factors by absolute weight.
5. Return the output JSON. Do not include explanation prose — structured JSON only.

## Scenario profile overrides
- `rate_shock_200bps`: add 2.00 to fed_funds_rate; set regime to TIGHTENING; surprise_index = 0.85
- `rate_shock_300bps`: add 3.00 to fed_funds_rate; set regime to TIGHTENING; surprise_index = 0.95
- `credit_stress`: set surprise_index to 0.6; add credit_spread driver
- `liquidity_crunch`: set surprise_index to 0.75; add funding_cost driver
- `base`: use retrieved values unchanged

## Output contract
- `confidence` must be between 0.50 and 0.99
- `surprise_index` must be between -1.0 and 1.0
- `regime` must be exactly one of: EASING, TIGHTENING, FLAT
- Return valid JSON only — no markdown, no prose
```

**Agent spec** (`specs/agents/treasury-macro-signal.yaml`):

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment

metadata:
  name: treasury-macro-signal
  domain: treasury-alm
  version: 1.0.0
  description: >
    Collects macro-economic indicators, computes composite surprise index,
    classifies rate regime (EASING/TIGHTENING/FLAT), identifies key rate drivers.
    IRR Agent 1 in the Treasury ALM/IRRBB pipeline.
  owner: atom-platform-team

spec:
  agent_role_file: agent-roles/treasury/treasury-macro-signal.role.md
  reasoning_mode: prescribed
  model: gemini/gemini-2.0-flash
  temperature: 0.2

  tools:
    - name: get_macro_indicators
      description: "Retrieve macro-economic indicators for a given run date from the treasury data warehouse"
      method: POST
      endpoint: "{{ env.TREASURY_DW_URL | default('http://treasury-dw:8090') }}/macro/indicators"
    - name: compute_surprise_index
      description: "Compute surprise index by comparing indicators to consensus estimates"
      method: POST
      endpoint: "{{ env.TREASURY_DW_URL | default('http://treasury-dw:8090') }}/macro/surprise-index"

  input_schema:
    type: object
    required: [run_date, scenario_profile]
    properties:
      run_date:        { type: string }
      scenario_profile: { type: string }

  sample_prompts:
    - "Collect macro signals for 2026-05-19, base scenario"
    - "Run macro signal collection for rate_shock_200bps scenario"
    - "What is the current rate regime?"

  output_schema:
    type: object
    required: [regime, surprise_index, rate_drivers, macro_indicators, confidence]
    properties:
      regime:          { type: string, enum: [EASING, TIGHTENING, FLAT] }
      surprise_index:  { type: number }
      rate_drivers:    { type: array }
      macro_indicators: { type: object }
      confidence:      { type: number }
```

**Completion criteria:**
- [ ] `POST /agents/treasury-macro-signal/compile` produces parseable AgentScope code
- [ ] `POST /agents/treasury-macro-signal/deploy` issues service-account, builds container
- [ ] `POST /agents/treasury-macro-signal/invoke` with `{"run_date": "2026-05-19", "scenario_profile": "base"}` returns valid JSON with `regime`, `surprise_index`, `confidence`
- [ ] MinIO audit log shows actor=svc-acct-treasury-macro-signal-...

---

### T3 — Agent role file: `treasury-sentiment-nlp`

**File**: `agent-roles/treasury/treasury-sentiment-nlp.role.md`

**Verbatim role file content:**

```markdown
# Role: Treasury Sentiment & NLP Analyst

## Purpose
Apply hawkish/dovish scoring to macro signals. Build hawkish (H) and dovish (D)
momentum indices. Identify active behavioral patterns relevant to the current
rate regime and run date.

## Inputs
- `macro_signal` (object): output from treasury-macro-signal agent
- `run_date` (string, ISO YYYY-MM-DD)

## Output schema (JSON)
```json
{
  "hawkish_score": <float, 0.0–1.0>,
  "dovish_score": <float, 0.0–1.0>,
  "hd_momentum": <float, -1.0 to 1.0, positive=hawkish>,
  "dominant_tone": "HAWKISH | DOVISH | NEUTRAL",
  "behavioral_patterns": [
    {"pattern": str, "active": bool, "weight": float, "description": str}
  ],
  "signal_summary": str,
  "run_date": str
}
```

## Reasoning mode: prescribed

Follow these steps strictly:

1. **Score hawkish signals**: fed_funds_rate > 4.5 → +0.2; cpi_yoy > 3.0 → +0.2; gdp_growth > 2.5 → +0.1; unemployment < 4.0 → +0.1; surprise_index > 0.5 → +0.2. Cap at 1.0.
2. **Score dovish signals**: fed_funds_rate < 3.0 → +0.2; cpi_yoy < 2.0 → +0.2; gdp_growth < 1.0 → +0.2; unemployment > 5.5 → +0.1; surprise_index < -0.3 → +0.1. Cap at 1.0.
3. **Compute HD momentum**: `hd_momentum = hawkish_score - dovish_score`
4. **Classify dominant tone**: hd_momentum > 0.2 → HAWKISH; hd_momentum < -0.2 → DOVISH; otherwise NEUTRAL.
5. **Identify behavioral patterns** using the `get_behavioral_patterns` tool. Mark active patterns based on current regime and HD scores.
6. Return the output JSON. Structured JSON only — no prose.

## Output contract
- `hawkish_score` and `dovish_score` must each be in [0.0, 1.0]
- `hd_momentum` must be in [-1.0, 1.0]
- `dominant_tone` must be exactly one of: HAWKISH, DOVISH, NEUTRAL
- Return valid JSON only
```

**Agent spec** (`specs/agents/treasury-sentiment-nlp.yaml`):

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment

metadata:
  name: treasury-sentiment-nlp
  domain: treasury-alm
  version: 1.0.0
  description: >
    Applies hawkish/dovish scoring to macro signals. Builds H/D momentum indices.
    Identifies active behavioral patterns. IRR Agent 2 in the Treasury ALM/IRRBB pipeline.
  owner: atom-platform-team

spec:
  agent_role_file: agent-roles/treasury/treasury-sentiment-nlp.role.md
  reasoning_mode: prescribed
  model: gemini/gemini-2.0-flash
  temperature: 0.2

  tools:
    - name: get_behavioral_patterns
      description: "Retrieve known behavioral patterns for the current rate regime from the treasury data warehouse"
      method: POST
      endpoint: "{{ env.TREASURY_DW_URL | default('http://treasury-dw:8090') }}/behavioral/patterns"

  input_schema:
    type: object
    required: [macro_signal, run_date]
    properties:
      macro_signal: { type: object }
      run_date:     { type: string }

  sample_prompts:
    - "Analyse sentiment from macro signals for 2026-05-19"
    - "What behavioral patterns are active in this EASING regime?"

  output_schema:
    type: object
    required: [hawkish_score, dovish_score, hd_momentum, dominant_tone, behavioral_patterns]
    properties:
      hawkish_score:       { type: number }
      dovish_score:        { type: number }
      hd_momentum:         { type: number }
      dominant_tone:       { type: string, enum: [HAWKISH, DOVISH, NEUTRAL] }
      behavioral_patterns: { type: array }
```

**Completion criteria:**
- [ ] `POST /agents/treasury-sentiment-nlp/invoke` with macro_signal from T2 returns valid JSON with `dominant_tone`, `hd_momentum`
- [ ] EASING regime → dominant_tone = DOVISH (hd_momentum < -0.2)
- [ ] rate_shock_200bps → dominant_tone = HAWKISH (hd_momentum > 0.2)

---

### T4 — Agent role file: `treasury-rate-forecast`

**File**: `agent-roles/treasury/treasury-rate-forecast.role.md`

**Verbatim role file content:**

```markdown
# Role: Treasury Rate Forecast Modeller

## Purpose
Combine macro signals and sentiment to produce a 4-scenario rate forecast tree
using Taylor Rule + H/D overlay. Compute probability weights for each scenario
using a 3-pillar dynamic weighting approach. Output a confidence score for the
model's overall reliability.

## Inputs
- `macro_signal` (object): output from treasury-macro-signal agent
- `sentiment_signal` (object): output from treasury-sentiment-nlp agent
- `scenario_profile` (string): base | rate_shock_200bps | rate_shock_300bps | credit_stress | liquidity_crunch

## Output schema (JSON)
```json
{
  "rate_scenarios": {
    "base":    {"rate": float, "probability": float, "12m_change_bps": int},
    "hike":    {"rate": float, "probability": float, "12m_change_bps": int},
    "cut":     {"rate": float, "probability": float, "12m_change_bps": int},
    "pause":   {"rate": float, "probability": float, "12m_change_bps": int}
  },
  "weighted_signal_composite": float,
  "confidence_score": float,
  "pillar_weights": {
    "macro_fundamental": float,
    "sentiment_momentum": float,
    "historical_pattern": float
  },
  "dominant_scenario": "base | hike | cut | pause",
  "forecast_summary": str
}
```

## Reasoning mode: prescribed

Follow these steps strictly:

1. **Compute Taylor Rule baseline**: neutral_rate = 2.0; target_rate = neutral_rate + 1.5*(cpi_yoy - 2.0) + 0.5*gdp_gap. Use `macro_signal.macro_indicators` values.
2. **Apply H/D overlay**: if dominant_tone = HAWKISH → add hd_momentum * 0.75 to target_rate; if DOVISH → subtract abs(hd_momentum) * 0.75.
3. **Build 4-scenario tree**:
   - Base: Taylor Rule + H/D rate, probability driven by confidence
   - Hike: base + 0.75%, probability = hawkish_score * 0.4
   - Cut: base - 0.75%, probability = dovish_score * 0.4
   - Pause: current fed_funds_rate, probability = 1.0 - base.prob - hike.prob - cut.prob
   - Normalize probabilities to sum to 1.0
4. **3-pillar weighting**: call `get_historical_patterns` for pillar 3. Weight: macro_fundamental = 0.4, sentiment_momentum = 0.35, historical_pattern = 0.25. Compute WeightedSignalComposite.
5. **Confidence score**: base confidence = 0.75; reduce by 0.05 per macro indicator with missing value; reduce by 0.1 if hd_momentum is near-zero (|hd_momentum| < 0.1); apply scenario_profile modifier (rate_shock_* → +0.1 confidence; credit_stress → -0.1; base → 0).
6. Apply scenario_profile: for rate_shock_200bps, override base.12m_change_bps = +200.
7. Return the output JSON. Structured JSON only.

## Output contract
- All four scenario probabilities must sum to 1.0 (within 0.001 tolerance)
- `confidence_score` must be in [0.0, 1.0]
- `dominant_scenario` must match the scenario with the highest probability
- Return valid JSON only
```

**Agent spec** (`specs/agents/treasury-rate-forecast.yaml`):

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment

metadata:
  name: treasury-rate-forecast
  domain: treasury-alm
  version: 1.0.0
  description: >
    Taylor Rule + H/D overlay → 4-scenario rate tree (Base/Hike/Cut/Pause) with
    probability weights. 3-pillar dynamic weighting → WeightedSignalComposite.
    Computes model confidence score. IRR Agent 3 in the Treasury ALM/IRRBB pipeline.
  owner: atom-platform-team

spec:
  agent_role_file: agent-roles/treasury/treasury-rate-forecast.role.md
  reasoning_mode: prescribed
  model: gemini/gemini-2.0-flash
  temperature: 0.3

  tools:
    - name: get_historical_patterns
      description: "Retrieve historical rate cycle patterns for the 3-pillar weighting model"
      method: POST
      endpoint: "{{ env.TREASURY_DW_URL | default('http://treasury-dw:8090') }}/historical/patterns"

  input_schema:
    type: object
    required: [macro_signal, sentiment_signal, scenario_profile]
    properties:
      macro_signal:     { type: object }
      sentiment_signal: { type: object }
      scenario_profile: { type: string }

  sample_prompts:
    - "Build rate forecast for base scenario on 2026-05-19"
    - "What is the rate forecast with rate_shock_200bps scenario?"
    - "What confidence does the model have in the current forecast?"

  output_schema:
    type: object
    required: [rate_scenarios, confidence_score, dominant_scenario, weighted_signal_composite]
    properties:
      rate_scenarios:            { type: object }
      confidence_score:          { type: number }
      dominant_scenario:         { type: string }
      weighted_signal_composite: { type: number }
      pillar_weights:            { type: object }
```

**Completion criteria:**
- [ ] `POST /agents/treasury-rate-forecast/invoke` returns valid JSON with `confidence_score` in [0.0, 1.0]
- [ ] `rate_scenarios` probabilities sum to 1.0 (within tolerance)
- [ ] For base scenario: `confidence_score` > 0.70 on at least 8/10 runs (triggers high-confidence path)
- [ ] For force_low_confidence path: confidence_score < 0.70 (triggers low-confidence-review node)

---

### T5 — Agent role file: `treasury-alco-intelligence`

**File**: `agent-roles/treasury/treasury-alco-intelligence.role.md`

**Verbatim role file content:**

```markdown
# Role: Treasury ALCO Intelligence Analyst

## Purpose
Synthesise all treasury pipeline context — macro signal, sentiment, rate forecast,
GAP analysis, NII simulation, EVE computation, Duration analysis — into exactly
5 prioritised hedge recommendations. Each recommendation must be backed by
3-pillar evidence: (1) historical insight, (2) macro factor, (3) analytical metric.
This is the ALCO intelligence brief that the Treasurer and ALCO committee review.

## Inputs
- `run_id` (string): run date + scenario profile identifier
- `macro_signal` (object): regime, surprise index, rate drivers
- `sentiment_signal` (object): H/D scores, behavioral patterns
- `forecast_object` (object): 4-scenario rate tree, confidence score
- `gap_report` (object): repricing gaps by tenor, breach flag
- `nii_report` (object): NII-at-Risk, regulatory breach flag
- `eve_report` (object): ΔEVE, regulatory breach flag, headroom pct
- `duration_report` (object): Duration of Equity, gap, convexity, breach flag
- `scenario_profile` (string): the scenario that was run
- `tier1_capital` (float): Tier 1 capital in USD millions

## Output schema (JSON)
```json
{
  "run_id": str,
  "scenario_profile": str,
  "risk_summary": {
    "overall_risk_level": "LOW | MEDIUM | HIGH | CRITICAL",
    "breach_count": int,
    "compound_risk_flag": bool,
    "compound_risk_description": str
  },
  "recommendations": [
    {
      "priority": int,           // 1 = highest priority
      "hedge_type": str,         // e.g. "Interest Rate Swap", "Cap/Floor", "Bond Sale"
      "instrument": str,         // specific instrument
      "direction": str,          // "receive-fixed" | "pay-fixed" | "buy" | "sell"
      "tenor": str,              // e.g. "5Y", "3Y", "overnight"
      "notional_usd_m": float,   // notional in USD millions
      "rationale": str,          // one-line rationale
      "evidence": {
        "historical": str,       // pillar 1: historical insight
        "macro": str,            // pillar 2: macro factor
        "analytical": str        // pillar 3: analytical metric (with numbers)
      },
      "urgency": "IMMEDIATE | THIS_CYCLE | NEXT_CYCLE",
      "risk_metric_addressed": str
    }
  ],
  "alco_notes": str,
  "generated_at": str
}
```

## Reasoning mode: guided

You have full reasoning latitude to synthesise across all inputs. There is no
prescribed step sequence. Apply your judgment to:

1. **Identify breaches**: check all four risk metric breach flags. If multiple breaches exist, set compound_risk_flag=true and describe the interaction.
2. **Prioritise by severity**: P1 = regulatory breach with <10% headroom; P2 = regulatory breach with headroom; P3 = board limit breach; P4 = trending toward breach; P5 = proactive management.
3. **Select instruments**: match hedge instruments to the specific risk being addressed. EVE breach → IRS (receive-fixed shortens duration). NII breach → caps/floors or variable-rate bonds. Gap breach → liability repricing or FRAs. Duration breach → sell long-dated assets or buy duration hedges.
4. **3-pillar evidence per recommendation**: cite a specific historical precedent (e.g. "2013 taper tantrum: banks with short duration assets outperformed"), a macro factor from the current signal (with a number), and an analytical metric from the risk reports (with a number and threshold reference).
5. **Exactly 5 recommendations**: no more, no fewer. If fewer than 5 breaches/risks exist, add proactive management recommendations for the highest-risk metrics.
6. **Compound risk narrative**: if compound_risk_flag=true, describe the interaction between breaches (e.g. "simultaneous EVE breach and high NII sensitivity creates a directionally opposing hedge problem — IRS shortens duration (addresses EVE) but increases NII sensitivity if rates fall").

## Output contract
- `recommendations` array must have exactly 5 elements
- `priority` values must be 1, 2, 3, 4, 5 (no duplicates)
- Each recommendation must have non-empty evidence for all three pillars
- `overall_risk_level` must be CRITICAL if any regulatory_breach_flag=true
- Return valid JSON only — no markdown wrapper, no prose outside JSON
```

**Agent spec** (`specs/agents/treasury-alco-intelligence.yaml`):

```yaml
apiVersion: atom.platform/v1
kind: AgentDeployment

metadata:
  name: treasury-alco-intelligence
  domain: treasury-alm
  version: 1.0.0
  description: >
    Synthesises macro, sentiment, forecast, gap, NII, EVE, and duration context
    into exactly 5 prioritised hedge recommendations. Each backed by 3-pillar
    evidence: historical insight, macro factor, analytical metric.
    ALM Agents 5+6 in the Treasury ALM/IRRBB pipeline.
  owner: atom-platform-team

spec:
  agent_role_file: agent-roles/treasury/treasury-alco-intelligence.role.md
  reasoning_mode: guided
  model: gemini/gemini-2.5-pro
  temperature: 1.0

  tools:
    - name: get_instrument_portfolio
      description: "Retrieve current instrument portfolio from UVAB balance sheet"
      method: POST
      endpoint: "{{ env.UVAB_COMPUTE_URL | default('http://uvab-compute:3030') }}/portfolio/instruments"
    - name: store_alco_brief
      description: "Persist ALCO intelligence brief for UVAB frontend display"
      method: POST
      endpoint: "{{ env.UVAB_COMPUTE_URL | default('http://uvab-compute:3030') }}/alco/briefs"

  input_schema:
    type: object
    required: [run_id, macro_signal, sentiment_signal, forecast_object, scenario_profile]
    properties:
      run_id:           { type: string }
      macro_signal:     { type: object }
      sentiment_signal: { type: object }
      forecast_object:  { type: object }
      gap_report:       { type: object }
      nii_report:       { type: object }
      eve_report:       { type: object }
      duration_report:  { type: object }
      scenario_profile: { type: string }
      tier1_capital:    { type: number }

  sample_prompts:
    - "Generate ALCO brief for base EASING scenario"
    - "Synthesise all ALM risk into 5 hedge recommendations with breach context"
    - "Generate hedge recommendations for rate_shock_200bps scenario with EVE breach"

  output_schema:
    type: object
    required: [run_id, risk_summary, recommendations]
    properties:
      run_id:          { type: string }
      risk_summary:    { type: object }
      recommendations: { type: array, minItems: 5, maxItems: 5 }
      alco_notes:      { type: string }
```

**Completion criteria:**
- [ ] `POST /agents/treasury-alco-intelligence/invoke` returns exactly 5 recommendations
- [ ] Each recommendation has non-empty `evidence.historical`, `evidence.macro`, `evidence.analytical`
- [ ] `overall_risk_level` = CRITICAL for rate_shock_200bps scenario (at least one breach flag)
- [ ] `compound_risk_flag` = true for rate_shock_200bps scenario (EVE + NII breach)

---

### T6 — UVAB compute mock service

**File**: `mocks/uvab_compute/app.py`  
**Port**: 3030 (internal), `3030:3030` in docker-compose.yml  
**docker-compose service name**: `uvab-compute`

The mock must implement all four ALM endpoints with realistic seeded data per scenario profile.

**Endpoint implementations:**

```
POST /alm/gap-analysis
  Input: {assets, liabilities, scenario_profile, forecast_rates}
  Output:
    {
      "gaps": {
        "overnight": float, "1m": float, "3m": float, "6m": float,
        "1y": float, "3y": float, "5y": float, "10y_plus": float
      },
      "breach_flag": bool,  // true if cumulative gap > 15% of total assets
      "repricing_summary": {
        "total_rate_sensitive_assets": float,
        "total_rate_sensitive_liabilities": float,
        "net_gap": float
      }
    }
  Scenario modifiers:
    base: gap pattern from seeded UVAB balance sheet (net_gap = -120M, breach_flag = false)
    rate_shock_200bps: amplify gaps 2x, breach_flag = true
    rate_shock_300bps: amplify gaps 3x, breach_flag = true
    credit_stress: shift overnight and 1m gaps negative, breach_flag = true
    liquidity_crunch: widen short-tenor gaps, breach_flag = true

POST /alm/nii-simulation
  Input: {gaps, base_nii, tier1_capital, scenario_profile}
  Output:
    {
      "nii_at_risk": float,          // USD millions
      "nii_at_risk_pct": float,      // as % of base_nii
      "regulatory_breach_flag": bool,// true if nii_at_risk > 20% of tier1_capital
      "breach_scenarios": [str],     // which shock scenarios breached
      "hedge_trigger": bool,         // true if nii_at_risk_pct > 82% of board limit (25%)
      "shock_results": {
        "parallel_up_200": float, "parallel_down_200": float,
        "short_up": float, "short_down": float,
        "flat": float, "steep": float
      }
    }
  Scenario modifiers:
    base: nii_at_risk = 28M (11.4% of base_nii), regulatory_breach_flag = false
    rate_shock_200bps: nii_at_risk = 68M (27.8%), regulatory_breach_flag = true
    rate_shock_300bps: nii_at_risk = 95M (38.8%), regulatory_breach_flag = true

POST /alm/eve-sensitivity
  Input: {assets, liabilities, tier1_capital, scenario_profile}
  Output:
    {
      "delta_eve": float,               // USD millions (negative = value loss)
      "delta_eve_pct_tier1": float,     // |delta_eve| / tier1_capital * 100
      "regulatory_breach_flag": bool,   // true if delta_eve_pct_tier1 > 15%
      "headroom_pct": float,            // 15% - delta_eve_pct_tier1
      "nmd_drift_flag": bool,
      "shock_results": {
        "parallel_up_200": float, "parallel_down_200": float,
        "short_up": float, "short_down": float,
        "flat": float, "steep": float
      }
    }
  Scenario modifiers:
    base: delta_eve = -112M (11.8% of tier1), regulatory_breach_flag = false, headroom = 3.2%
    rate_shock_200bps: delta_eve = -158M (16.6%), regulatory_breach_flag = true, headroom = -1.6%
    rate_shock_300bps: delta_eve = -195M (20.5%), regulatory_breach_flag = true, headroom = -5.5%

POST /alm/duration-of-equity
  Input: {assets, liabilities, scenario_profile}
  Output:
    {
      "duration_of_equity": float,    // years
      "duration_gap": float,          // asset_duration - weighted_liability_duration
      "convexity": float,
      "breach_flag": bool,            // true if duration_of_equity > 5 years
      "asset_duration": float,
      "liability_duration": float
    }
  Scenario modifiers:
    base: duration_of_equity = 4.2Y, breach_flag = false
    rate_shock_200bps: duration_of_equity = 5.8Y, breach_flag = true
    rate_shock_300bps: duration_of_equity = 6.4Y, breach_flag = true

GET /portfolio/instruments
  Returns seeded instrument portfolio (used by alco-intelligence agent)

POST /alco/briefs
  Persists ALCO intelligence brief; returns {brief_id, stored_at}
  In-memory store, resets on restart
```

**Seeded UVAB balance sheet** (for all endpoints, base case):
- Total assets: ~USD 2,100M
- Rate-sensitive assets: 1,680M
- Rate-sensitive liabilities: 1,800M
- base_nii: 245M (seeded default for NII simulation)
- tier1_capital: 950M (seeded default)

**docker-compose.yml addition:**
```yaml
  uvab-compute:
    build: ./mocks/uvab_compute
    ports:
      - "3030:3030"
    networks: [agentnet]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3030/health"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**Environment variable** (`UVAB_COMPUTE_URL=http://uvab-compute:3030`) added to:
- `workflow-backend` service env in docker-compose.yml
- Agent containers via `UVAB_COMPUTE_URL` in builder-backend env and codegen

**Completion criteria:**
- [ ] `GET http://localhost:3030/health` returns `{"status": "healthy"}`
- [ ] `POST /alm/gap-analysis` with base scenario returns `breach_flag: false`
- [ ] `POST /alm/gap-analysis` with rate_shock_200bps returns `breach_flag: true`
- [ ] `POST /alm/eve-sensitivity` with rate_shock_200bps returns `regulatory_breach_flag: true`, `delta_eve_pct_tier1 > 15`
- [ ] `POST /alm/nii-simulation` with rate_shock_200bps returns `regulatory_breach_flag: true`
- [ ] `POST /alm/duration-of-equity` with rate_shock_200bps returns `breach_flag: true` (DoE > 5Y)

---

### T7 — Workflow backend: register treasury-task-queue

**Files modified**: `workflow-backend/app/worker/runner.py`, `workflow-backend/app/main.py`

The existing `AtomWorkflowRunner` and Temporal worker already handle `ats-task-queue`. A second task queue (`treasury-task-queue`) must be registered so the Treasury workflow can be executed.

**Change required in `main.py`**:
```python
# Start second Temporal worker for treasury queue
asyncio.create_task(_run_worker(task_queue="treasury-task-queue"))
```

**Worker activities** are identical to the ATS worker (invoke_agent, http_call, decision, human_task). No new activity types needed — the workflow spec interpreter handles Treasury nodes using the same four activities.

**Completion criteria:**
- [ ] `POST /specs/workflow/validate` on `treasury-alm-irrbb.yaml` returns VALID, 12 nodes, queue=treasury-task-queue
- [ ] `POST /workflows/treasury-alm-irrbb/register` succeeds
- [ ] Worker logs show `[worker] starting treasury-task-queue` on boot
- [ ] `POST /workflows/treasury-alm-irrbb/runs` with base scenario starts a workflow execution in Temporal

---

### T8 — Workflow Composer: render treasury workflow

**Files modified**: frontend only (no new files unless a Treasury-specific node renderer is needed)

The Workflow Composer must load and render the Treasury workflow with all 12 nodes at their `metadata.layout` positions.

**UI requirements:**
- Treasury workflow appears in ComposerLanding registered workflow list
- Opens in Composer with all 12 nodes rendered (dagre auto-layout respects hand-computed y-positions)
- All three demo sample_inputs appear as chips in the Run pane
- SSE event stream highlights nodes as they execute (same mechanism as ATS)
- `confidence-gate` decision node has T/F handles (condition passes → governance, fails → low-confidence-review)
- `low-confidence-review` node renders as amber HumanTaskNode with escalation info in inspector

**Inspector fields to verify:**
- `alco-intelligence-brief` node: shows agent name `treasury-alco-intelligence`, reasoning_mode badge = "guided" (orange caution chip)
- `governance-treasurer-review` node: shows assignee_group=treasury, sla_seconds=86400, escalation_policy
- `gap-analysis`, `nii-simulation`, `eve-sensitivity`, `duration-equity` nodes: url_template shows uvab-compute endpoint

**Completion criteria:**
- [ ] Treasury workflow opens in Composer with all 12 nodes visible
- [ ] Node colors: agent=violet, http=sky, decision=amber, human_task=emerald
- [ ] `alco-intelligence-brief` inspector shows reasoning_mode=guided with orange caution chip
- [ ] Three sample inputs render as chips in Run pane
- [ ] Validate button → VALID response (12 nodes, treasury-task-queue)
- [ ] Run pane: base EASING cycle run starts and SSE events light up nodes sequentially

---

### T9 — End-to-end: base EASING cycle path

Run the base EASING cycle demo path end-to-end.

**Setup:**
1. Deploy all four treasury agents via `POST /agents/{name}/deploy-direct` (or Builder wizard)
2. Register the treasury-alm-irrbb workflow via `POST /workflows/treasury-alm-irrbb/register`
3. Verify uvab-compute mock is healthy at port 3030

**Run:**
```bash
POST /workflows/treasury-alm-irrbb/runs
{
  "run_date": "2026-05-19",
  "scenario_profile": "base",
  "triggered_by": "ALCO_TRIGGER"
}
```

**Expected node execution:**
1. `collect-macro-signals` → macro_signal.regime = EASING, confidence ≥ 0.7
2. `ingest-nlp-sentiment` → dominant_tone = DOVISH, hd_momentum < 0
3. `rate-forecast-modelling` → confidence_score > 0.70, 4 scenarios with probabilities summing to 1.0
4. `confidence-gate` → routes to `governance-treasurer-review`
5. `governance-treasurer-review` → pauses workflow, human task created in task-queue
6. Resolve via `POST /tasks/{id}/resolve` `{resolution: "approve"}`
7. `gap-analysis` → gap_report.breach_flag = false (base scenario)
8. `nii-simulation` → nii_report.regulatory_breach_flag = false
9. `eve-sensitivity` → eve_report.regulatory_breach_flag = false
10. `duration-equity` → duration_report.breach_flag = false (DoE < 5Y)
11. `alco-intelligence-brief` → 5 recommendations, overall_risk_level = MEDIUM
12. `alco-approval` → pauses, human task created

**Completion criteria:**
- [ ] All 12 nodes execute without error
- [ ] Workflow pauses at governance-treasurer-review and alco-approval
- [ ] Both human tasks resolvable via Tasks UI
- [ ] After final resolve: run status = COMPLETED in Temporal
- [ ] Audit trail in MinIO shows actor_type=agent for treasury agents, actor_type=human for task resolutions
- [ ] `alco_recommendations` has exactly 5 recommendations with 3-pillar evidence each

---

### T10 — End-to-end: low confidence overlay path

**Run:**
```bash
POST /workflows/treasury-alm-irrbb/runs
{
  "run_date": "2026-05-19",
  "scenario_profile": "base",
  "triggered_by": "MANUAL",
  "force_low_confidence": true
}
```

The `treasury-rate-forecast` agent must honour `force_low_confidence` input. Add a note to its role file:
> If input contains `force_low_confidence: true`, set `confidence_score = 0.55` and return.

**Expected node execution:**
1. `collect-macro-signals` → normal execution
2. `ingest-nlp-sentiment` → normal execution
3. `rate-forecast-modelling` → confidence_score = 0.55 (forced)
4. `confidence-gate` → condition `0.55 > 0.70` = false → routes to `low-confidence-review`
5. `low-confidence-review` → pauses, human task created (treasury assignee group)
6. Resolve `{resolution: "approve_overlay", overlay_notes: "Geopolitical risk elevated — expect FOMC hold"}`
7. `governance-treasurer-review` → pauses again
8. Resolve `{resolution: "approve"}`
9. ALM nodes execute (same as base path)
10. `alco-intelligence-brief` → generates recommendations incorporating overlay context
11. `alco-approval` → pauses

**Completion criteria:**
- [ ] `confidence-gate` correctly routes to `low-confidence-review` when confidence < 0.70
- [ ] Two human tasks created (low-confidence-review + governance-treasurer-review) before ALM analysis
- [ ] `low_confidence_overlay` data is visible in `governance-treasurer-review` task payload
- [ ] Workflow completes after both tasks resolved

---

### T11 — End-to-end: rate shock +200bps stress path

**Run:**
```bash
POST /workflows/treasury-alm-irrbb/runs
{
  "run_date": "2026-05-19",
  "scenario_profile": "rate_shock_200bps",
  "triggered_by": "BALANCE_SHEET_CHANGE"
}
```

**Expected breach pattern** (from uvab-compute mock, seeded data):
- `gap-analysis.breach_flag` = true (rate_shock_200bps amplifies gaps 2x)
- `nii-simulation.regulatory_breach_flag` = true (NII@Risk = 68M, 27.8%)
- `eve-sensitivity.regulatory_breach_flag` = true (ΔEVE = -158M, 16.6% > 15% threshold)
- `duration-equity.breach_flag` = true (DoE = 5.8Y > 5Y limit)

**Expected ALCO brief output:**
- `overall_risk_level` = CRITICAL (4 breach flags)
- `compound_risk_flag` = true
- `compound_risk_description` describing the interaction between EVE breach and NII sensitivity
- All 5 recommendations have `urgency` = IMMEDIATE
- P1 recommendation: IRS receive-fixed (addresses EVE breach)

**Completion criteria:**
- [ ] All four ALM http nodes return `breach_flag: true`
- [ ] `alco-intelligence-brief` returns `overall_risk_level: CRITICAL`
- [ ] `compound_risk_flag: true` with description
- [ ] P1 recommendation is IRS hedge addressing EVE breach
- [ ] ALCO approval task shows all four breach flags in the payload summary

---

### T12 — Scripts and validation

**Files created:**
- `scripts/treasury-pre-warm.sh`
- `scripts/treasury-run-path.sh <base|low-confidence|rate-shock>`
- `scripts/treasury-validate-paths.sh`

Same pattern as ATS scripts (`scripts/pre-warm.sh`, `scripts/run-path.sh`, `scripts/validate-paths.sh`).

**`treasury-pre-warm.sh`:**
- Waits for all four treasury agents healthy
- Invokes each agent with a minimal test payload
- Checks workflow is registered (`GET /workflows/treasury-alm-irrbb`)
- Checks uvab-compute is healthy
- Warns if stale human tasks exist in task-queue

**`treasury-run-path.sh <path>`:**
- `base`: runs base EASING cycle; auto-resolves governance-treasurer-review and alco-approval; reports PASS/FAIL + timing
- `low-confidence`: runs with force_low_confidence=true; auto-resolves all three human tasks
- `rate-shock`: runs rate_shock_200bps; verifies all four breach flags before resolving

**`treasury-validate-paths.sh`:**
- Runs all three paths sequentially
- Exits non-zero if any path fails
- Reports timing for each path

**Completion criteria:**
- [ ] `treasury-pre-warm.sh` completes without errors
- [ ] `treasury-run-path.sh base` returns PASS in <180s
- [ ] `treasury-run-path.sh low-confidence` returns PASS in <180s (two human tasks)
- [ ] `treasury-run-path.sh rate-shock` returns PASS with breach_flags verified
- [ ] `treasury-validate-paths.sh` 3/3 PASS on two consecutive runs

---

### T13 — Audit trail verification + session log update

Verify the audit trail covers the complete Treasury ALM/IRRBB pipeline end-to-end.

**MinIO audit log requirements:**

For a complete base EASING cycle run, the MinIO `audit-logs/workflow/treasury-alm-irrbb/` bucket must contain:
- `run_start` event: `{run_id, workflow=treasury-alm-irrbb, scenario_profile=base, actor_type=human, actor_id=user:demo@atom.demo}`
- One `node_start` + `node_complete` event pair per node (12 pairs)
- `node_complete` for agent nodes: `{actor_type=agent, actor_id=svc-acct-treasury-<agent>-<hash>}`
- `node_complete` for http nodes: `{actor_type=system, actor_id=workflow-engine}`
- `node_paused` for human_task nodes: `{actor_type=system, task_id=<uuid>}`
- `node_resumed` for human_task nodes: `{actor_type=human, actor_id=user:demo@atom.demo, resolution=approve}`
- `run_complete` event: `{run_id, status=COMPLETED, duration_seconds}`

**Audit pane UI requirements:**
- All treasury workflow run events visible in `/audit` events pane
- Agent service-account IDs (svc-acct-treasury-*) visually distinct from human actor IDs
- `node_paused` / `node_resumed` events show HITL events correctly

**Session log update** (`docs/tasks/_session-log.md`):
- Add Session 11 entry with what was done, DoD checklist, known issues, and what's next

**Completion criteria:**
- [ ] MinIO `audit-logs/workflow/treasury-alm-irrbb/` bucket populated after first complete run
- [ ] All 12 node pairs (node_start + node_complete) present
- [ ] Agent events show treasury agent service-account IDs (not master key)
- [ ] Human task events show human actor IDs with resolution data
- [ ] Audit pane in UI shows treasury events correctly (actor_type chips working)
- [ ] Session log entry added

---

## Tool Registration Reference

The following tools are registered across the four treasury agents and must exist in the platform-db tools table (and have corresponding endpoints in the treasury-dw and uvab-compute mocks):

| Tool name | Endpoint | Owner agent | Purpose |
|---|---|---|---|
| `get_macro_indicators` | `http://treasury-dw:8090/macro/indicators` | treasury-macro-signal | Retrieve fed_funds_rate, CPI, GDP, unemployment, yield curve |
| `compute_surprise_index` | `http://treasury-dw:8090/macro/surprise-index` | treasury-macro-signal | Compute surprise index vs consensus |
| `get_behavioral_patterns` | `http://treasury-dw:8090/behavioral/patterns` | treasury-sentiment-nlp | Retrieve known behavioral patterns for current regime |
| `get_historical_patterns` | `http://treasury-dw:8090/historical/patterns` | treasury-rate-forecast | Historical rate cycle patterns for 3-pillar weighting |
| `get_instrument_portfolio` | `http://uvab-compute:3030/portfolio/instruments` | treasury-alco-intelligence | Current instrument portfolio from UVAB balance sheet |
| `store_alco_brief` | `http://uvab-compute:3030/alco/briefs` | treasury-alco-intelligence | Persist ALCO brief for UVAB frontend display |

**Environment variables required** (add to docker-compose.yml builder-backend and workflow-backend envs):
```
TREASURY_DW_URL=http://treasury-dw:8090
UVAB_COMPUTE_URL=http://uvab-compute:3030
```

The `treasury-dw` mock already exists from Session 02 (port 8090). New endpoints needed on existing mock:
- `POST /macro/surprise-index` (new — add to `mocks/treasury_dw/app.py`)
- `POST /behavioral/patterns` (new)
- `POST /historical/patterns` (new)

---

## Docker Configuration Reference

### New service: `uvab-compute`

**`mocks/uvab_compute/app.py`** — FastAPI mock, ~150 lines  
**`mocks/uvab_compute/requirements.txt`**: `fastapi>=0.100.0`, `uvicorn>=0.23.0`  
**`mocks/uvab_compute/Dockerfile`**:
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3030"]
```

**docker-compose.yml additions:**
```yaml
  uvab-compute:
    build: ./mocks/uvab_compute
    container_name: atom-uvab-compute
    ports:
      - "3030:3030"
    networks: [agentnet]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3030/health"]
      interval: 10s
      timeout: 5s
      retries: 5
```

### Modified services in docker-compose.yml

**`workflow-backend`**: add `UVAB_COMPUTE_URL=http://uvab-compute:3030` to env  
**`builder-backend`**: add `UVAB_COMPUTE_URL=http://uvab-compute:3030` and `TREASURY_DW_URL=http://treasury-dw:8090` to env  
**`workflow-backend` depends_on**: add `uvab-compute: {condition: service_healthy}`

### Agent container runtime env

The codegen pipeline must inject `UVAB_COMPUTE_URL` and `TREASURY_DW_URL` into deployed treasury agent containers. These are read from the builder-backend environment and passed through to the agent's `.env` at compile time.

---

## Data Model Reference

### New tables (platform-db)

No new tables are required for the treasury workflow itself — the existing workflow engine tables (`workflow_runs`, `workflow_events`, human task handling) already support the treasury workflow nodes. However, two new tables are recommended for treasury-specific analytics:

**`treasury_runs`** — tracks each ALCO pipeline execution:
```sql
CREATE TABLE IF NOT EXISTS treasury_runs (
    id                SERIAL PRIMARY KEY,
    run_id            TEXT NOT NULL UNIQUE,
    run_date          DATE NOT NULL,
    scenario_profile  TEXT NOT NULL,
    triggered_by      TEXT,
    temporal_run_id   TEXT,
    confidence_score  FLOAT,
    overall_risk_level TEXT,
    breach_flags      JSONB DEFAULT '{}',
    recommendation_count INT DEFAULT 0,
    status            TEXT DEFAULT 'running',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    completed_at      TIMESTAMPTZ
);
```

**`treasury_recommendations`** — stores the 5 recommendations per run:
```sql
CREATE TABLE IF NOT EXISTS treasury_recommendations (
    id                SERIAL PRIMARY KEY,
    run_id            TEXT NOT NULL,
    priority          INT NOT NULL,
    hedge_type        TEXT,
    instrument        TEXT,
    direction         TEXT,
    tenor             TEXT,
    notional_usd_m    FLOAT,
    rationale         TEXT,
    evidence_historical TEXT,
    evidence_macro    TEXT,
    evidence_analytical TEXT,
    urgency           TEXT,
    risk_metric       TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
```

**`uvab_alco_briefs`** — persisted by `store_alco_brief` tool call (uvab-compute mock uses in-memory; this is the platform-db version for the Audit pane):
```sql
CREATE TABLE IF NOT EXISTS uvab_alco_briefs (
    id             SERIAL PRIMARY KEY,
    brief_id       TEXT NOT NULL UNIQUE,
    run_id         TEXT NOT NULL,
    scenario_profile TEXT,
    risk_summary   JSONB,
    recommendations JSONB,
    alco_notes     TEXT,
    generated_at   TIMESTAMPTZ,
    stored_at      TIMESTAMPTZ DEFAULT NOW()
);
```

**`treasury_agent_events`** — per-node performance tracking:
```sql
CREATE TABLE IF NOT EXISTS treasury_agent_events (
    id              SERIAL PRIMARY KEY,
    run_id          TEXT NOT NULL,
    node_id         TEXT NOT NULL,
    agent_name      TEXT,
    service_account TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    duration_ms     INT,
    output_keys     TEXT[],
    error           TEXT
);
```

**`treasury_breach_history`** — historical breach flag record per run:
```sql
CREATE TABLE IF NOT EXISTS treasury_breach_history (
    id                  SERIAL PRIMARY KEY,
    run_id              TEXT NOT NULL,
    run_date            DATE NOT NULL,
    scenario_profile    TEXT,
    gap_breach          BOOLEAN DEFAULT false,
    nii_breach          BOOLEAN DEFAULT false,
    eve_breach          BOOLEAN DEFAULT false,
    duration_breach     BOOLEAN DEFAULT false,
    compound_risk       BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);
```

These tables are written to by the workflow-backend activities when treasury workflow nodes complete. The workflow runner detects `workflow = treasury-alm-irrbb` and writes to these treasury-specific tables in addition to the general `workflow_events` audit log.

---

## Frontend Changes Reference

### UVAB Treasury Dashboard (new page, `src/pages/treasury/Dashboard.tsx`)

A read-only dashboard showing the current state of the treasury workflow for UVAB end-users (not the Atom platform operator). Linked from the sidebar under a new `TREASURY` nav group.

**Components:**
- **Run status card**: current run_date, scenario_profile, overall_risk_level chip (LOW=green, MEDIUM=amber, HIGH=orange, CRITICAL=red), breach flags grid
- **Risk metrics panel**: four risk gauges (Gap, NII, EVE, Duration) showing current values vs thresholds. Each gauge colored by breach status.
- **5 Recommendations list**: priority-ranked cards. Each card shows hedge_type, instrument, direction, tenor, notional, rationale, and collapsible 3-pillar evidence block.
- **Audit trail mini-pane**: last 10 treasury workflow events (node_complete + human resolutions)
- **Trigger buttons**: "Run ALCO Cycle" (base), "Run Stress Test" (rate_shock_200bps), "Run Manual Override" (opens scenario selector)

**API calls added to `src/api/workflow.ts`:**
- `GET /workflows/treasury-alm-irrbb/runs` — last 5 runs
- `GET /workflows/treasury-alm-irrbb/runs/{run_id}` — run detail with full output
- `POST /workflows/treasury-alm-irrbb/runs` — trigger new run

**Sidebar addition (`src/components/Sidebar.tsx`):**
```
TREASURY
  ├── ALM Dashboard     (/treasury/dashboard)
  └── ALCO Briefs       (/treasury/briefs)     [list of past briefs]
```

---

## DoD Checklist

### Workflow spec
- [ ] `treasury-alm-irrbb.yaml` validates VALID (12 nodes, treasury-task-queue)
- [ ] Three demo_paths defined in spec, expected_path arrays match node IDs
- [ ] BFSI validator: all http nodes (gap, NII, EVE, duration) are downstream of governance-treasurer-review human_task
- [ ] Spec saved via Composer UI, registered in workflow-backend

### Agents
- [ ] `treasury-macro-signal` deployed, invoked, returns regime + confidence
- [ ] `treasury-sentiment-nlp` deployed, invoked, returns dominant_tone
- [ ] `treasury-rate-forecast` deployed, invoked, returns 4 scenarios with probabilities summing to 1.0
- [ ] `treasury-alco-intelligence` deployed, invoked, returns exactly 5 recommendations
- [ ] All four agents have service-account IDs in LiteLLM and platform-db
- [ ] All four agents route LLM calls through GATE:8083 (LITELLM_BASE_URL=http://gate:8083)
- [ ] Agent role files in `agent-roles/treasury/` (4 files)
- [ ] Agent specs in `specs/agents/` (4 files)

### uvab-compute mock
- [ ] Service healthy at port 3030
- [ ] All four ALM endpoints respond correctly for all scenario profiles
- [ ] Breach flags triggered correctly for rate_shock_200bps (all four breaches)
- [ ] `/portfolio/instruments` and `/alco/briefs` endpoints functional

### workflow-backend
- [ ] `treasury-task-queue` Temporal worker starts on boot
- [ ] Workflow registers and runs end-to-end for all three paths

### Demo paths
- [ ] Base EASING cycle: all 12 nodes, 2 human tasks (governance + alco-approval), 5 recommendations
- [ ] Low confidence overlay: 12 nodes, 3 human tasks (low-confidence + governance + alco-approval)
- [ ] Rate shock +200bps: all 4 breach flags, CRITICAL risk level, compound_risk_flag=true
- [ ] `treasury-validate-paths.sh` 3/3 PASS on two consecutive runs

### Audit
- [ ] MinIO `audit-logs/workflow/treasury-alm-irrbb/` populated
- [ ] Treasury agent service-account IDs in audit (not master key)
- [ ] Human HITL events in audit with resolution data
- [ ] Audit pane shows treasury events correctly

### Frontend
- [ ] Treasury workflow renders in Composer (12 nodes, correct colors)
- [ ] `alco-intelligence-brief` inspector shows guided reasoning badge (orange caution chip)
- [ ] Run pane: 3 sample inputs, SSE live node highlighting
- [ ] Treasury Dashboard page accessible at `/treasury/dashboard`
- [ ] Risk gauges display breach status correctly for rate_shock_200bps scenario

### Documentation
- [ ] Session log entry added to `docs/tasks/_session-log.md`
- [ ] All four agent role files and specs are complete and committed
- [ ] `specs/workflows/treasury-alm-irrbb.yaml` committed
