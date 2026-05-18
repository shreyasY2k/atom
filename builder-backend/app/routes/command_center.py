"""
Command Center API — security observability for the ATOM platform.

Surfaces per-agent LLM call stats, guardrail event summaries, and the
10-layer security posture for the Command Center dashboard in the frontend.

All data is read from platform-db (llm_call_events + guardrail_events tables
written by GATE:8083 and the LiteLLM guardrail hooks).
"""

from fastapi import APIRouter, Query
from pydantic import BaseModel
from app.core import registry_db

router = APIRouter(prefix="/command-center", tags=["command-center"])

# Static 10-layer security architecture definition.
# layer_id matches the labels written by the guardrail code.
_SECURITY_LAYERS = [
    {
        "layer_id": "L1-LocalHeuristic",
        "name": "Local Heuristic Scan",
        "description": "Inline regex detection for prompt injection, jailbreaks, and destructive commands. Fail-closed — no network call required.",
        "where": "agentarmor_guardrail.py",
        "phase": "pre_call",
        "fail_mode": "CLOSED",
        "number": 1,
    },
    {
        "layer_id": "L2-PII",
        "name": "PII Detection + Redaction",
        "description": "Detects and masks email, SSN, credit card, phone, DOB, and IP addresses before the LLM sees the request.",
        "where": "pii_guardrail.py",
        "phase": "pre_call",
        "fail_mode": "OPEN",
        "number": 2,
    },
    {
        "layer_id": "L3-Ingestion",
        "name": "AgentArmor Input Ingestion",
        "description": "Semantic injection detection and context analysis via AgentArmor API.",
        "where": "AgentArmor /v1/scan/input",
        "phase": "pre_call",
        "fail_mode": "OPEN",
        "number": 3,
    },
    {
        "layer_id": "L4-GoalLock",
        "name": "Goal-Lock (Context Hijacking)",
        "description": "Verifies the agent stays on its assigned goal and has not been context-hijacked.",
        "where": "AgentArmor /v1/scan/input",
        "phase": "pre_call",
        "fail_mode": "OPEN",
        "number": 4,
    },
    {
        "layer_id": "L5-PlanningRisk",
        "name": "Planning Risk Score",
        "description": "Scores planned agent actions for risk. Blocks if score ≥ 7.",
        "where": "AgentArmor /v1/scan/input",
        "phase": "pre_call",
        "fail_mode": "OPEN",
        "number": 5,
    },
    {
        "layer_id": "L6-RateLimit",
        "name": "Per-Agent Rate Limiting",
        "description": "Enforces per-agent request rate limits to prevent runaway agents.",
        "where": "AgentArmor /v1/scan/input",
        "phase": "pre_call",
        "fail_mode": "OPEN",
        "number": 6,
    },
    {
        "layer_id": "L7-GATEProxy",
        "name": "GATE LLM Proxy Audit",
        "description": "Mandatory audit of every LLM call through GATE:8083. Agents cannot bypass this layer.",
        "where": "GATE :8083",
        "phase": "proxy",
        "fail_mode": "N/A",
        "number": 7,
    },
    {
        "layer_id": "L8-ToolPermission",
        "name": "Tool Permission Enforcement",
        "description": "Per-agent tool allowlist enforced at the LiteLLM gateway. Disallowed tool calls are blocked.",
        "where": "LiteLLM tool_permission guardrail",
        "phase": "post_call",
        "fail_mode": "CLOSED",
        "number": 8,
    },
    {
        "layer_id": "L9-OutputScan",
        "name": "Output PII + Credential Scan",
        "description": "Scans LLM output for PII leakage and exposed credentials before returning to the agent.",
        "where": "AgentArmor /v1/scan/output",
        "phase": "post_call",
        "fail_mode": "OPEN",
        "number": 9,
    },
    {
        "layer_id": "L10-Exfiltration",
        "name": "Exfiltration Detection",
        "description": "Detects and blocks data exfiltration attempts in LLM output.",
        "where": "AgentArmor /v1/scan/output",
        "phase": "post_call",
        "fail_mode": "OPEN",
        "number": 10,
    },
]


class GuardrailEventIn(BaseModel):
    service_account_id: str = ""
    agent_name: str = ""
    layer: str
    phase: str
    verdict: str
    threat_type: str = ""
    threat_level: str = ""
    pii_types: str = ""
    gate_run_id: str = ""


@router.post("/internal/events", status_code=201)
def ingest_guardrail_event(event: GuardrailEventIn):
    """
    Internal endpoint called by LiteLLM guardrail hooks (agentarmor, pii) to
    record guardrail decisions. Not exposed through GATE to external callers.
    """
    import psycopg2
    import os
    db_url = os.environ.get("DATABASE_URL", "postgresql://atom:atom@platform-db:5432/atom")
    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO guardrail_events
                  (gate_run_id, service_account_id, agent_name, layer, phase,
                   verdict, threat_type, threat_level, pii_types)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                event.gate_run_id or None,
                event.service_account_id or None,
                event.agent_name or None,
                event.layer,
                event.phase,
                event.verdict,
                event.threat_type or None,
                event.threat_level or None,
                event.pii_types or None,
            ))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.get("/overview")
def get_overview(hours: int = Query(24, ge=1, le=168)):
    """Platform-wide aggregate stats: call volume, blocks, PII events, latency."""
    stats = registry_db.get_command_center_overview(hours)
    return {"hours": hours, **stats}


@router.get("/agents")
def get_agent_stats(hours: int = Query(24, ge=1, le=168)):
    """Per-agent LLM call stats: call count, latency, errors, guardrail events."""
    rows = registry_db.get_per_agent_stats(hours)
    return {"hours": hours, "agents": rows}


@router.get("/layers")
def get_security_layers(hours: int = Query(24, ge=1, le=168)):
    """
    Returns the 10-layer security posture with live event counts.

    Status logic:
    - L1, L2: active if they have fired (guardrail_events rows); idle otherwise
    - L3-L6 (AgentArmor API): active if any LLM calls happened in the window
      (they scan every call; idle only means no violations, not that they're off)
    - L7 (GATE proxy): active if any llm_call_events exist in the window
    - L8 (Tool permission): active if any LLM calls happened (enforced on every call)
    - L9-L10 (AgentArmor output): active if any LLM calls happened
    """
    db_stats: dict[str, dict] = {}
    for row in registry_db.get_guardrail_layer_stats(hours):
        db_stats[row["layer"]] = row

    # Derive how many LLM calls happened in the window (proxy for "layers are scanning")
    overview = registry_db.get_command_center_overview(hours)
    llm_calls_in_window = int(overview.get("total_calls") or 0)
    any_llm_calls = llm_calls_in_window > 0

    # Layers that are "active" whenever LLM calls are happening (they always scan)
    _ALWAYS_SCANNING = {"L3-Ingestion", "L4-GoalLock", "L5-PlanningRisk",
                        "L6-RateLimit", "L7-GATEProxy", "L8-ToolPermission",
                        "L9-OutputScan", "L10-Exfiltration"}

    result = []
    for layer in _SECURITY_LAYERS:
        db = db_stats.get(layer["layer_id"], {})
        blocks = int(db.get("blocks") or 0)
        redactions = int(db.get("redactions") or 0)
        total = int(db.get("total_events") or 0)
        last_event = db.get("last_event")

        if total > 0:
            status = "active"
        elif layer["layer_id"] in _ALWAYS_SCANNING and any_llm_calls:
            # These layers scan every call but only write events on violations.
            # Show as active when LLM calls are happening, even without events.
            status = "active"
        else:
            status = "idle"

        result.append({
            **layer,
            "status": status,
            "total_events": total,
            "blocks": blocks,
            "redactions": redactions,
            "last_event": last_event.isoformat() if last_event else None,
        })

    return {"hours": hours, "layers": result}


@router.get("/timeseries")
def get_timeseries(hours: int = Query(24, ge=1, le=168)):
    """Hourly time-series data for charts: call volume, latency percentiles, guardrail events."""
    return {"hours": hours, **registry_db.get_timeseries(hours)}


@router.get("/events")
def get_recent_events(limit: int = Query(50, ge=1, le=200)):
    """Most recent guardrail events (blocks + redactions) across all agents."""
    events = registry_db.get_recent_guardrail_events(limit)
    return {"events": events}
