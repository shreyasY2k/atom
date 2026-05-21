#!/usr/bin/env python3
"""
Register treasury ALM/IRRBB agents, tools, and workflow on the Atom platform.

Run from the atom/ repo root:
  python3 scripts/register_treasury_workflow.py

Prerequisites:
  - Atom docker stack running (builder-backend :8080, workflow-backend :8082)
  - UVAB services will be on host.docker.internal:3000 (gateway) and :3030 (compute)
    OR on the atom-uvab Docker network as uvab-gateway:3000 and uvab-compute:3030
"""

import json
import sys
import time
import requests

BUILDER = "http://localhost:8080"
WORKFLOW = "http://localhost:8082"
HEADERS = {"X-Atom-Actor": "user:treasury-setup@atom.io", "Content-Type": "application/json"}

# UVAB endpoints — use host.docker.internal so agent containers can reach UVAB on host
UVAB_COMPUTE = "http://host.docker.internal:3030"
UVAB_GATEWAY = "http://host.docker.internal:13000"


def ok(resp, label):
    if resp.status_code >= 400:
        print(f"  FAIL {label}: {resp.status_code} {resp.text[:300]}")
        return False
    print(f"  OK   {label}")
    return True


# ── Step 1: Register 10 tools ─────────────────────────────────────────────────
print("\n=== Step 1: Registering 10 treasury tools ===")

TOOLS = [
    {
        "name": "run_gap_analysis",
        "display_name": "ALM Gap Analysis",
        "description": "Run repricing gap analysis across 8 tenor buckets (O/N to 10Y+). Returns RSA, RSL, gaps, cumulative gaps.",
        "tool_type": "http",
        "endpoint": f"{UVAB_COMPUTE}/alm/gap-analysis",
        "method": "POST",
        "input_schema": {
            "type": "object",
            "required": ["assets", "liabilities"],
            "properties": {
                "assets": {"type": "array", "description": "List of {notional, repricing_bucket}"},
                "liabilities": {"type": "array", "description": "List of {notional, repricing_bucket}"},
            }
        },
        "tags": ["treasury", "alm", "irrbb"],
    },
    {
        "name": "run_nii_simulation",
        "display_name": "NII Simulation",
        "description": "Simulate NII impact across 6 rate-shock scenarios (+/-50/100/200bps). Breach if NII@Risk > 20% Tier 1.",
        "tool_type": "http",
        "endpoint": f"{UVAB_COMPUTE}/alm/nii-simulation",
        "method": "POST",
        "input_schema": {
            "type": "object",
            "required": ["gaps", "base_nii", "tier1_capital"],
            "properties": {
                "gaps": {"type": "object"},
                "base_nii": {"type": "number"},
                "tier1_capital": {"type": "number"},
            }
        },
        "tags": ["treasury", "alm", "irrbb", "nii"],
    },
    {
        "name": "run_eve_sensitivity",
        "display_name": "EVE Sensitivity",
        "description": "Compute ΔEVE under 6 Basel III IRRBB shocks. Breach if ΔEVE > 15% Tier 1 capital.",
        "tool_type": "http",
        "endpoint": f"{UVAB_COMPUTE}/alm/eve-sensitivity",
        "method": "POST",
        "input_schema": {
            "type": "object",
            "required": ["assets", "liabilities", "tier1_capital"],
            "properties": {
                "assets": {"type": "array"},
                "liabilities": {"type": "array"},
                "tier1_capital": {"type": "number"},
                "asset_cash_flows": {"type": "array"},
                "liability_cash_flows": {"type": "array"},
                "base_yield_curve": {"type": "object"},
            }
        },
        "tags": ["treasury", "alm", "irrbb", "eve"],
    },
    {
        "name": "run_duration_equity",
        "display_name": "Duration of Equity",
        "description": "Compute Duration of Equity: (DA*MVA - DL*MVL)/(MVA-MVL). Breach if > 5 years.",
        "tool_type": "http",
        "endpoint": f"{UVAB_COMPUTE}/alm/duration-of-equity",
        "method": "POST",
        "input_schema": {
            "type": "object",
            "required": ["assets", "liabilities"],
            "properties": {
                "assets": {"type": "array"},
                "liabilities": {"type": "array"},
                "asset_cash_flows": {"type": "array"},
                "liability_cash_flows": {"type": "array"},
            }
        },
        "tags": ["treasury", "alm", "irrbb", "duration"],
    },
    {
        "name": "run_irrbb_suite",
        "display_name": "IRRBB Full Suite",
        "description": "Run complete IRRBB suite: gap analysis + NII simulation + EVE sensitivity + Duration of Equity in one call.",
        "tool_type": "http",
        "endpoint": f"{UVAB_COMPUTE}/alm/irrbb-suite",
        "method": "POST",
        "input_schema": {
            "type": "object",
            "required": ["balance_sheet", "base_nii", "tier1_capital"],
            "properties": {
                "balance_sheet": {"type": "object", "description": "{assets: [...], liabilities: [...]}"},
                "base_nii": {"type": "number"},
                "tier1_capital": {"type": "number"},
                "asset_cash_flows": {"type": "array"},
                "liability_cash_flows": {"type": "array"},
                "base_yield_curve": {"type": "object"},
            }
        },
        "tags": ["treasury", "alm", "irrbb"],
    },
    {
        "name": "get_treasury_instruments",
        "display_name": "Treasury Instruments",
        "description": "Get treasury instruments from the Master Instrument DB (50 instruments: mortgages, CDs, loans, securities, swaps, deposits).",
        "tool_type": "http",
        "endpoint": f"{UVAB_GATEWAY}/api/v1/treasury/instruments",
        "method": "GET",
        "input_schema": {
            "type": "object",
            "properties": {
                "side": {"type": "string", "enum": ["Asset", "Liability", "Off-Balance", "Equity"]},
                "product": {"type": "string"},
            }
        },
        "tags": ["treasury", "data", "instruments"],
    },
    {
        "name": "get_historical_timeseries",
        "display_name": "Historical Time-Series",
        "description": "Get historical time-series for instruments across 4 scenarios: Base, Rate Shock, Credit Stress, Liquidity Crunch.",
        "tool_type": "http",
        "endpoint": f"{UVAB_GATEWAY}/api/v1/treasury/timeseries",
        "method": "GET",
        "input_schema": {
            "type": "object",
            "properties": {
                "instrument_id": {"type": "string", "description": "e.g. CFG-0001"},
                "scenario": {"type": "string", "enum": ["Base", "Rate Shock", "Credit Stress", "Liquidity Crunch"]},
            }
        },
        "tags": ["treasury", "data", "historical"],
    },
    {
        "name": "get_macro_factors",
        "display_name": "Macro-Economic Factors",
        "description": "Get current macro-economic indicators (Fed Funds, 10Y UST, SOFR, CPI, GDP etc.) with AI weights and NII/EVE impact signals.",
        "tool_type": "http",
        "endpoint": f"{UVAB_GATEWAY}/api/v1/treasury/macro-factors",
        "method": "GET",
        "input_schema": {"type": "object", "properties": {}},
        "tags": ["treasury", "macro", "data"],
    },
    {
        "name": "get_behavioral_patterns",
        "display_name": "Behavioral Patterns",
        "description": "Get AI-extracted behavioral patterns (BP-001 to BP-012): prepayment surges, deposit beta shifts, CRE delinquency, CD maturity walls, etc.",
        "tool_type": "http",
        "endpoint": f"{UVAB_GATEWAY}/api/v1/treasury/behavioral-patterns",
        "method": "GET",
        "input_schema": {
            "type": "object",
            "properties": {
                "pattern_id": {"type": "string", "description": "e.g. BP-002. Omit for all 12 patterns."},
            }
        },
        "tags": ["treasury", "behavioral", "patterns"],
    },
    {
        "name": "store_alco_recommendations",
        "display_name": "Store ALCO Recommendations",
        "description": "Store 5 ALCO hedge recommendations for the UVAB frontend. Each recommendation must have 3-pillar evidence.",
        "tool_type": "http",
        "endpoint": f"{UVAB_GATEWAY}/api/v1/atom/workflow/results",
        "method": "POST",
        "input_schema": {
            "type": "object",
            "required": ["run_id", "recommendations"],
            "properties": {
                "run_id": {"type": "string"},
                "recommendations": {"type": "array", "description": "List of exactly 5 recommendation dicts"},
                "macro_context": {"type": "object"},
                "alm_results": {"type": "object"},
                "confidence_score": {"type": "number"},
            }
        },
        "tags": ["treasury", "recommendations", "alco"],
    },
]

tool_ids = {}
for tool in TOOLS:
    resp = requests.post(f"{BUILDER}/tools", headers=HEADERS, json=tool)
    if ok(resp, f"tool {tool['name']}"):
        tool_ids[tool["name"]] = resp.json()["tool_id"]
    else:
        print(f"    Response: {resp.text[:200]}")


import yaml
from pathlib import Path

AGENT_SPECS = [
    "treasury-macro-signal",
    "treasury-sentiment-nlp",
    "treasury-rate-forecast",
    "treasury-alco-intelligence",
]

AGENT_ROLE_FILES = {
    "treasury-macro-signal": "agent-roles/treasury/macro-signal-collector.role.md",
    "treasury-sentiment-nlp": "agent-roles/treasury/sentiment-nlp-agent.role.md",
    "treasury-rate-forecast": "agent-roles/treasury/rate-forecast-agent.role.md",
    "treasury-alco-intelligence": "agent-roles/treasury/alco-intelligence-agent.role.md",
}

AGENT_TOOLS = {
    "treasury-macro-signal":       ["get_macro_factors", "get_treasury_instruments"],
    "treasury-sentiment-nlp":      ["get_macro_factors", "get_behavioral_patterns"],
    "treasury-rate-forecast":      ["get_macro_factors", "get_behavioral_patterns"],
    "treasury-alco-intelligence":  [
        "get_treasury_instruments", "get_historical_timeseries",
        "get_macro_factors", "get_behavioral_patterns",
        "run_irrbb_suite", "store_alco_recommendations",
    ],
}

AGENT_DESCRIPTIONS = {
    "treasury-macro-signal":      "Macro signal collector — first stage of IRRBB pipeline",
    "treasury-sentiment-nlp":     "Sentiment & NLP ingestion agent — H/D index for rate forecast",
    "treasury-rate-forecast":     "Rate forecast modelling agent — 4-scenario ALM quant model",
    "treasury-alco-intelligence": "ALCO intelligence & recommendation engine — final synthesis layer",
}


# ── Step 2: Provision agents (creates DB record so tools can be associated) ───
print("\n=== Step 2: Provisioning 4 treasury agents ===")

for name in AGENT_SPECS:
    resp = requests.post(
        f"{BUILDER}/agents",
        headers=HEADERS,
        json={"name": name, "description": AGENT_DESCRIPTIONS[name]},
    )
    if resp.status_code == 409:
        print(f"  SKIP {name}: already exists")
    else:
        ok(resp, f"provision {name}")


# ── Step 3: Associate tools BEFORE deploy so codegen injects inline HTTP fns ──
print("\n=== Step 3: Associating tools with agents ===")

for agent_name, tools in AGENT_TOOLS.items():
    for tool_name in tools:
        tid = tool_ids.get(tool_name)
        if not tid:
            print(f"  SKIP {agent_name}/{tool_name}: tool_id not found (registration failed above)")
            continue
        resp = requests.post(
            f"{BUILDER}/agents/{agent_name}/tools/associate",
            headers=HEADERS,
            json={"tool_id": tid},
        )
        ok(resp, f"associate {agent_name} ← {tool_name}")


# ── Step 4: Validate agent specs ──────────────────────────────────────────────
print("\n=== Step 4: Validating agent specs ===")

for name in AGENT_SPECS:
    spec_path = Path("specs/agents") / f"{name}.yaml"
    if not spec_path.exists():
        print(f"  MISS spec not found: {spec_path}")
        continue
    yaml_text = spec_path.read_text()
    resp = requests.post(
        f"{BUILDER}/specs/agent/validate",
        headers=HEADERS,
        json={"yaml_text": yaml_text},
    )
    ok(resp, f"validate {name}")
    if resp.status_code >= 400:
        print(f"    {resp.json()}")


# ── Step 5: Deploy agents (tools are now associated, codegen will inject them) ─
print("\n=== Step 5: Deploying 4 treasury agents ===")

for name in AGENT_SPECS:
    spec_path = Path("specs/agents") / f"{name}.yaml"
    role_path = Path(AGENT_ROLE_FILES[name])

    if not spec_path.exists():
        print(f"  SKIP {name}: spec not found")
        continue

    spec_yaml = spec_path.read_text()
    skill_content = role_path.read_text() if role_path.exists() else None

    resp = requests.post(
        f"{BUILDER}/agents/{name}/deploy",
        headers=HEADERS,
        json={"spec_yaml": spec_yaml, "skill_content": skill_content},
    )
    ok(resp, f"deploy {name}")
    if resp.status_code >= 400:
        data = resp.json()
        print(f"    {str(data)[:300]}")
    else:
        data = resp.json()
        print(f"    endpoint={data.get('endpoint')} sa={data.get('service_account_id','?')[:20]}")


# ── Step 6: Register workflow ─────────────────────────────────────────────────
print("\n=== Step 6: Registering treasury-alm-irrbb workflow ===")

wf_yaml = Path("specs/workflows/treasury-alm-irrbb.yaml").read_text()
resp = requests.post(
    f"{WORKFLOW}/workflows/treasury-alm-irrbb/register",
    headers=HEADERS,
    json={"yaml_text": wf_yaml},
)
ok(resp, "register treasury-alm-irrbb")
if resp.status_code < 400:
    data = resp.json()
    print(f"    task_queue={data.get('task_queue')} hash={data.get('spec_hash')} warnings={data.get('warnings', [])}")
else:
    print(f"    {resp.text[:300]}")


print("\n=== Done ===")
