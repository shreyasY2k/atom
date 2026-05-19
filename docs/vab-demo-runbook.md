# VAB Treasury Intelligence Platform — Demo Runbook

**Version**: 1.0  
**Date**: 2026-05-19  
**Platform**: Atom Agent Platform + VAB (Virtual Agentic Bank)  
**Use case**: ALM / IRRBB — AI-Driven ALCO Analysis

---

## What This Demo Shows

A Treasury team uses an AI-driven ALCO (Asset-Liability Committee) workflow to:
1. Automatically analyse macroeconomic signals and forecast interest rates
2. Run IRRBB compliance checks on their real portfolio
3. Receive 5 AI-generated hedge recommendations backed by 3-pillar evidence
4. Approve or reject each recommendation individually through a human-in-the-loop gate

The AI runs on **Atom** (Temporal workflow engine + AgentScope agents) and analyses a real $13.2B bank portfolio from the Treasury AI PoC Database.

---

## Prerequisites

### Services running

| Service | URL | Purpose |
|---|---|---|
| VAB UI | http://localhost:8081 | Treasury Command Center |
| VAB Gateway | http://localhost:13000 | REST + WebSocket |
| Atom Builder | http://localhost:8080 | Agent management |
| Atom Workflow | http://localhost:8082 | Temporal worker |
| Atom Gate | http://localhost:8083 | LLM proxy (GATE → LiteLLM → Gemini) |
| VAB Compute | http://localhost:3030 | Python ALM math (BCBS d368) |

### Check everything is healthy

```bash
# VAB services
docker ps --filter "name=infra-" --format "{{.Names}}\t{{.Status}}"

# Atom services
docker ps --filter "name=workflow-backend\|builder-backend" --format "{{.Names}}\t{{.Status}}"

# Quick health checks
curl http://localhost:13000/health    # VAB gateway
curl http://localhost:8082/health     # Atom workflow backend
```

### Pre-demo cleanup (IMPORTANT)

Run before every demo to ensure clean state:

```bash
# Terminate any stale Temporal workflows
docker exec workflow-backend python3 -c "
import asyncio
async def cleanup():
    from temporalio.client import Client
    c = await Client.connect('temporal:7233', namespace='default')
    async for w in c.list_workflows('WorkflowType=\"AtomWorkflowRunner\" AND ExecutionStatus=\"Running\"'):
        await c.get_workflow_handle(w.id).terminate(reason='pre_demo_cleanup')
        print('terminated', w.id)
asyncio.run(cleanup())
"

# Clear pending tasks
curl -s http://localhost:8098/tasks | python3 -c "
import json,sys,subprocess
d=json.load(sys.stdin)
tasks=d if isinstance(d,list) else d.get('tasks',[])
for t in [t for t in tasks if t.get('status')=='OPEN']:
    subprocess.run(['curl','-s','-X','POST',f'http://localhost:8082/tasks/{t[\"task_id\"]}/resolve',
        '-H','Content-Type: application/json',
        '-d','{\"resolution\":\"reject\",\"resolved_by\":\"system:cleanup\"}'],capture_output=True)
print(f'cleared {len(tasks)} tasks')
"

# Clear VAB gateway pending tasks
curl -s http://localhost:13000/api/v1/atom/tasks/pending | python3 -c "
import json,sys,subprocess
d=json.load(sys.stdin)
for t in d.get('tasks',[]):
    subprocess.run(['curl','-s','-X','DELETE',f'http://localhost:13000/api/v1/atom/tasks/{t[\"task_id\"]}'],capture_output=True)
print(f'cleared {len(d.get(\"tasks\",[]))} gateway tasks')
"

# Hard refresh VAB UI (in browser)
# Cmd+Shift+R  (clears localStorage including stale run_id)
```

---

## Demo Scenarios

Three bank profiles are available, each with distinct risk characteristics:

| Profile | Portfolio Size | Key Risk | Best For |
|---|---|---|---|
| **Community Bank** | $1.6B | Low — within all limits | Contrast: "healthy bank" |
| **Regional Bank** | $13.2B | EXTREME — EVE breach, 49y duration | Primary demo — AI urgently needed |
| **Large Bank** | $40.5B | High — asset-sensitive corporate | Enterprise scale contrast |

Five rate shock scenarios:

| Scenario | Shock | Use case |
|---|---|---|
| **Base** | 0 bps | Current market rates |
| **+200bps** | +200 bps | Basel III regulatory stress |
| **+300bps** | +300 bps | Severe tightening cycle |
| **+100bps (Credit)** | +100 bps | Credit stress + rate move |
| **-100bps** | -100 bps | Rate cut / liquidity crunch |

---

## Demo Flow — Primary (Regional Bank, Base Scenario)

### Step 1: Open the dashboard (~30 seconds)

Open **http://localhost:8081** — the VAB Treasury Command Center.

**Point to the KPI strip at the top:**
> "This is our live portfolio. The ALM system has already detected a problem."

| KPI | Value | What it means |
|---|---|---|
| `IRRBB Status` | 🔴 RED | Regulatory breach detected |
| `EVE Δ (worst)` | `-$887.8M` | Economic Value of Equity loss under +200bps |
| `Duration of Equity` | `49.8y` | **10× the regulatory 5-year limit** |
| `Cum Gap @1Y` | `-$5.3B` | $5.3B more liabilities than assets reprice in Year 1 |

> "The bank has $9.2 billion in long-term fixed mortgages (10+ years) funded by $8.5 billion in short-term deposits (6 months). This is a classic ALM mismatch. The conventional system flags it. But it can't tell you what to do about it."

**Point to the bank profile selector:**
> "We have three bank profiles. Let me start with the Regional Bank — this is the most challenged portfolio."

Select: **Regional Bank** + **Base** scenario.

---

### Step 2: Click "Run AI-Driven Analysis" (~2 min, automated)

**Click the button.** A 9-step workflow begins in Atom (Temporal engine).

**Watch the Kanban advance in real time:**

| Step | What the AI does | Time |
|---|---|---|
| 1. Macro Signal Collection | Reads Fed Funds (4.75%), 10Y UST (4.25%), SOFR, CPI from DB | ~20s |
| 2. Sentiment & NLP | Scores macro as DOVISH (H/D index -0.65) | ~20s |
| 3. Rate Forecast | Taylor Rule + sentiment → 4 scenarios: Base 55%, Cut 25%, Hike 10% | ~25s |
| 4. Confidence Gate | 78% confidence > 70% threshold → proceeds directly | instant |

> "Three independent AI agents have analysed the macro environment and reached a consensus: EASING cycle, 78% confidence. Now the system pauses for human sign-off before touching the balance sheet."

**At Step 6 (Governance Review): Kanban shows amber ⏸**

---

### Step 3: Approval Gate — Governance Review (~1 min, human action)

**The right column shows the Approval Gate with a pending task:**

```
AWAITING DECISION
Rate Forecast Approval Required — base (2026-05-19)

Rate Regime: EASING    Fed Funds: 4.75%    Confidence: 78%
```

**Walk through the context:**
> "The AI has detected an EASING regime. Fed Funds dropped 50bps, 10Y UST dropped 55bps. Confidence is 78%. The system is asking the Treasurer: does this match your view of the market?"

**Add rationale and approve:**
1. Type: `"EASING regime confirmed. 2 more Fed cuts expected in 2026. Proceed with ALM analysis."`
2. Click **"✓ Approve — Continue Workflow"**

**Kanban advances:** Steps 6→7 (ALM Suite running).

---

### Step 4: ALM Suite runs (~15 seconds, automated)

> "After Treasurer approval, the workflow calls our Python compute service with the real $13.2B portfolio. No hardcoded numbers — this is the live Treasury AI PoC Database."

**The system computes:**

| Metric | Result | Limit | Status |
|---|---|---|---|
| Gap @1Y | -$5.3B (liability-sensitive) | — | — |
| NII at Risk (-200bps) | -336% of annual NII | < 20% | 🔴 BREACH |
| EVE (Parallel +200bps) | -$887M | < 15% Tier 1 | 🔴 BREACH |
| Duration of Equity | 49.8 years | < 5 years | 🔴 BREACH |

> "Three simultaneous regulatory breaches. Now the AI synthesises all of this — historical behavioral patterns, macro signals, AND the ALM math — into specific, evidenced recommendations."

---

### Step 5: AI Recommendations tab (~2 min, review)

Click **"AI Recommendations"** tab.

**5 cards appear** — each backed by three independent evidence pillars:

**P1 🔴 — CFG-0029 (Pay-Fixed IRS): Unwind collar on $250M**

Click to expand each pillar:

- 📊 **Historical Insight**: "BP-011: Swap Mark-to-Market Drag — 2020 COVID rally observed MTM -8.5% of notional (79% confidence, Monte Carlo). Pay-fixed swaps move deeply negative in rate rally. Portfolio CFG-0029 exposed to same dynamic."

- 🌐 **Macro Factor**: "SOFR at 4.68%, Decreasing -50bps YoY (8% AI weight). Floating receive leg yields compressing rapidly against fixed pay leg."

- 📐 **Analytical Factor**: "Duration of equity at 49.8 years exceeds 5-year board limit by 10×. DV01 exposure = -$0.14M/bp."

> "This is not a generic recommendation. The AI found a specific behavioral pattern from the historical database, matched it to a specific macro signal, and quantified the risk in ALM terms — all automatically, in 90 seconds."

**Point through P2–P5:**
- P2: $400M mortgage hedge to protect reinvestment risk (BP-001 prepayment pattern)
- P3: $500M MBS hedge for EVE tail risk (BP-002 duration extension)
- P4: Let $150M brokered CDs roll off (BP-003 deposit beta regime shift)
- P5: Rotate $200M UST 10Y to 2Y (BP-008 yield curve inversion effect)

---

### Step 6: ALCO Approval — Individual decisions (~2 min, human action)

**Go back to ALCO Dashboard** → Approval Gate card shows 5 recommendations.

**Walk through the individual approve/reject toggles:**

> "The ALCO committee reviews each recommendation. They don't have to approve all 5. They can accept P1, P2, and P5 but reject P3 and P4 if they have a different view on MBS hedging. Every decision is individually tracked for audit."

1. Toggle **P1 → Accept** (✓ green)
2. Toggle **P2 → Accept** (✓ green)
3. Toggle **P3 → Accept** (✓ green)
4. Toggle **P4 → Accept** (✓ green)
5. Toggle **P5 → Reject** ✗ (e.g., "Duration shortening has excessive carry cost in current EASING environment")

Type rationale: `"ALCO approves P1-P4. P5 rejected — yield curve steepening expected to reduce duration gap naturally."`

Click **"Submit ALCO Decisions & Continue Workflow"**

**Workflow completes. All steps green ✓**

---

## Demo Flow — Scenario Comparison

**After the primary demo, show how scenarios change recommendations:**

### Community Bank comparison

1. Select **Community Bank** + **Base** scenario
2. Click "Run AI-Driven Analysis"
3. Approve forecast when asked
4. **Expected outcome**: Much more conservative recommendations — the bank is WITHIN limits, AI focuses on efficiency rather than regulatory compliance

> "This is a healthy community bank. Same EASING macro regime, same macro signals, but completely different recommendations — because the portfolio is different. The AI adapts to each bank's actual risk profile."

### Rate shock comparison

1. Select **Regional Bank** + **+200bps** scenario  
2. Click "Run AI-Driven Analysis"
3. **Expected outcome**: P1 and P3 recommendations become LARGER in notional (more aggressive hedging needed), with higher confidence scores and more urgent timelines

> "What happens if rates go up 200bps instead of down? The EASING base case flips to a stress scenario. The AI re-runs everything — same portfolio, different shock — and the hedge sizes immediately adjust. P1 notional goes from $250M to $400M because the EVE breach worsens."

---

## Key Talking Points

### What makes this different from conventional ALM

| Conventional | VAB AI |
|---|---|
| Reports what happened | Recommends what to do |
| Generic templates | Evidence from your specific behavioral patterns |
| Single scenario | 5 rate scenarios + 3 bank profiles simultaneously |
| Treasurer does the analysis | AI does analysis, Treasurer approves |
| Hours to ALCO package | 90 seconds to 5 evidenced recommendations |

### The 3-pillar evidence framework

Every recommendation cites:
1. **Historical behavioral pattern** (BP-001 to BP-012) — what happened to similar portfolios in similar rate cycles, with confidence score from the ML model
2. **Macro-economic factor** — which specific indicator is driving this recommendation (named indicator, current value, AI weight in the signal fusion)
3. **ALM analytical factor** — the specific gap/NII/EVE/Duration metric that makes this recommendation necessary

### Human-in-the-loop by design

- The workflow CANNOT proceed past Governance Review without Treasurer approval
- The workflow CANNOT proceed past ALCO Approval without committee decisions
- Every approval is logged with: timestamp, actor identity, rationale, and the exact workflow state at decision time
- Temporal guarantees these gates even if the system crashes — the workflow resumes from exactly where it was

### Audit trail

- Every agent invocation goes through GATE → LiteLLM → Gemini (logged)
- Every human decision is stored with actor_id, timestamp, and rationale
- All audit events written to MinIO with object lock (90-day compliance retention)
- The AI's service-account identity (`svc-acct-treasury-*`) is distinct from the human user identity

---

## Troubleshooting

### Approval Gate not showing

The task may not have notified the VAB UI yet. Wait 5 seconds for the polling to pick it up. If still missing:
```bash
curl -s http://localhost:13000/api/v1/atom/tasks/pending | python3 -m json.tool
```

### "All steps green immediately"

Old workflow data from a previous session. Hard refresh: **Cmd+Shift+R** (clears localStorage).

### Rate forecast fails / low confidence

The rate-forecast agent sometimes returns < 70% confidence → routes to "Low Confidence Review". Just approve the overlay with any rationale and the workflow continues.

### Recommendations show 0

Check if the ALCO intelligence agent ran:
```bash
docker logs agent-treasury-alco-intelligence-1-0-0 2>&1 | tail -20
```

If the agent crashed, restart it:
```bash
curl -s -X POST http://localhost:8080/agents/treasury-alco-intelligence/deploy \
  -H "Content-Type: application/json" \
  -H "X-Atom-Actor: user:treasury-setup@atom.io" \
  -d "{}"
```

### Phantom approval tasks appearing

Run the pre-demo cleanup script above. This terminates stale Temporal workflows.

---

## Architecture Reference

```
VAB UI (Next.js :8081)
    ↓ "Run AI-Driven Analysis"
VAB Gateway (:13000) ──── WebSocket broadcast ──→ UI real-time updates
    ↓ POST /api/atom/workflow/invoke
Atom Workflow Backend (:8082) ── Temporal ──→ treasury-task-queue
    ↓ Temporal activities
┌─────────────────────────────────────────┐
│  Agent 1: macro-signal-collector        │→ GATE:8083 → LiteLLM → Gemini
│  Agent 2: sentiment-nlp-agent           │→ GATE:8083 → LiteLLM → Gemini
│  Agent 3: rate-forecast-agent           │→ GATE:8083 → LiteLLM → Gemini
│  [Human Gate: Governance Review]        │→ Pause → VAB Approval Gate
│  HTTP: alm-full-suite                   │→ VAB Gateway :13000/api/v1/alm/run-suite
│      → VAB Compute :3030               │   (gap, NII, EVE, duration, Basel III)
│  Agent 4: alco-intelligence-agent       │→ GATE:8083 → LiteLLM → Gemini
│      ↓ store_alco_recommendations       │→ VAB Gateway (stored in Postgres)
│  [Human Gate: ALCO Approval]            │→ Pause → VAB Approval Gate
└─────────────────────────────────────────┘
    ↓ Audit
MinIO (object lock, 90-day compliance)
```

**Data flow for ALM math:**
```
treasury_instruments table (50 instruments, $13.2B)
    ↓ extractFromTreasuryInstruments(bank_profile, scenario_shock)
Python Compute Service (BCBS d368 compliant)
    ├── Gap Analysis (8 tenor buckets: O/N to 10Y+)
    ├── NII Simulation (6 rate scenarios: ±50/100/200bps)
    ├── EVE Sensitivity (6 Basel III IRRBB shocks)
    └── Duration of Equity (modified duration formula)
```

---

## Workflow Registration

If the Atom workflow needs to be re-registered after changes:

```bash
python3 scripts/register_treasury_workflow.py
```

This registers:
- 10 HTTP tools (VAB compute + data endpoints)
- 4 treasury agents (macro-signal, sentiment-nlp, rate-forecast, alco-intelligence)
- 1 workflow spec (treasury-alm-irrbb, 9 nodes, treasury-task-queue)
