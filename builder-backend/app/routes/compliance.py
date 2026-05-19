"""Compliance report generation for deployed agents.

POST /agents/{name}/compliance-report       — kick off report generation
GET  /agents/{name}/compliance-report/latest — get most recent report
GET  /agents/{name}/compliance-reports       — list all reports
"""

import json
import os
import threading
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from app.core import registry_db
from app.core.litellm_client import chat_completion

router = APIRouter(prefix="/agents", tags=["compliance"])


class ReportRequest(BaseModel):
    period_days: int = 30   # look-back window in days
    notes: str = ""         # optional context for the report


def _gather_agent_data(name: str, since: datetime) -> dict:
    """Collect all available data for the agent from platform-db."""
    agent = registry_db.get(name)
    if not agent:
        return {}

    since_iso = since.isoformat()

    with registry_db._cursor() as cur:
        # LLM call stats
        cur.execute("""
            SELECT COUNT(*) as total_calls,
                   COUNT(*) FILTER (WHERE status_code=200) as successful,
                   COUNT(*) FILTER (WHERE status_code>=400) as errors,
                   ROUND(AVG(latency_ms)) as avg_latency_ms,
                   ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)) as p95_ms,
                   MIN(created_at) as first_call,
                   MAX(created_at) as last_call
            FROM llm_call_events
            WHERE service_account_id=%s AND created_at >= %s
        """, (agent.get("service_account_id", ""), since_iso))
        call_stats = dict(cur.fetchone() or {})

        # Guardrail events
        cur.execute("""
            SELECT layer, verdict, COUNT(*) as n, array_agg(DISTINCT threat_type) as threat_types
            FROM guardrail_events
            WHERE service_account_id=%s AND created_at >= %s
            GROUP BY layer, verdict
            ORDER BY layer, verdict
        """, (agent.get("service_account_id", ""), since_iso))
        guardrail_rows = [dict(r) for r in cur.fetchall()]

        # PII events
        cur.execute("""
            SELECT pii_types, COUNT(*) as n
            FROM guardrail_events
            WHERE service_account_id=%s AND layer='L2-PII' AND created_at >= %s
            GROUP BY pii_types
        """, (agent.get("service_account_id", ""), since_iso))
        pii_rows = [dict(r) for r in cur.fetchall()]

        # Session activity
        cur.execute("""
            SELECT COUNT(DISTINCT s.session_id) as sessions,
                   COUNT(m.message_id) as messages
            FROM agent_sessions s
            LEFT JOIN session_messages m ON m.session_id=s.session_id
            WHERE s.agent_name=%s AND s.created_at >= %s
        """, (name, since_iso))
        session_stats = dict(cur.fetchone() or {})

        # Deployment history (last 5)
        cur.execute("""
            SELECT version, status, service_account_id, deployed_at
            FROM agents WHERE name=%s
        """, (name,))
        agent_row = dict(cur.fetchone() or {})

    return {
        "agent": agent,
        "period_start": since_iso,
        "period_end": datetime.now(timezone.utc).isoformat(),
        "call_stats": {k: (int(v) if isinstance(v, (int, float)) and v is not None else str(v) if v else 0) for k, v in call_stats.items()},
        "guardrail_events": guardrail_rows,
        "pii_events": pii_rows,
        "session_stats": {k: int(v or 0) for k, v in session_stats.items()},
    }


def _generate_report_async(report_id: str, name: str, data: dict, notes: str) -> None:
    """Run in a background thread — generate the report and update the DB record."""
    try:
        agent = data.get("agent", {})
        call_stats = data.get("call_stats", {})
        guardrail_events = data.get("guardrail_events", [])
        pii_events = data.get("pii_events", [])
        session_stats = data.get("session_stats", {})

        total_blocks = sum(r.get("n", 0) for r in guardrail_events if r.get("verdict") == "deny")
        total_redactions = sum(r.get("n", 0) for r in guardrail_events if r.get("verdict") == "redact")
        pii_types = sorted({pt for r in pii_events for pt in (r.get("pii_types") or "").split(",") if pt})

        prompt = f"""You are a compliance officer generating a formal AI Agent Compliance Report for a financial platform.

Generate a professional compliance report in Markdown for the following agent. Be specific with numbers. Use formal language appropriate for a bank compliance review.

## Agent Details
- **Name**: {agent.get('name', name)}
- **Service Account**: {agent.get('service_account_id', 'N/A')}
- **Version**: {agent.get('version', 'N/A')}
- **Owner**: {agent.get('owner', 'N/A')}
- **Domain**: {agent.get('domain', 'N/A')} / {agent.get('subdomain', 'N/A')}
- **Status**: {agent.get('status', 'N/A')}
- **Deployed**: {agent.get('deployed_at', 'N/A')}

## Activity Period
- **Period**: {data['period_start'][:10]} to {data['period_end'][:10]}
- **Total LLM Calls**: {call_stats.get('total_calls', 0)}
- **Successful Calls**: {call_stats.get('successful', 0)}
- **Failed Calls**: {call_stats.get('errors', 0)}
- **Average Latency**: {call_stats.get('avg_latency_ms', 0)}ms (p95: {call_stats.get('p95_ms', 0)}ms)
- **Chat Sessions**: {session_stats.get('sessions', 0)}
- **Total Messages**: {session_stats.get('messages', 0)}

## Security Events
- **Total Guardrail Blocks (L1)**: {total_blocks}
- **Total PII Redactions (L2)**: {total_redactions}
- **PII Types Detected**: {', '.join(pii_types) if pii_types else 'None'}
- **Guardrail Events by Layer**: {json.dumps(guardrail_events, default=str)}

## Additional Context
{notes if notes else 'No additional context provided.'}

Generate a compliance report with the following sections:

1. **Executive Summary** (2-3 sentences)
2. **Agent Identity & Deployment** (version, NHI, owner)
3. **Activity Summary** (volume, trends, usage patterns)
4. **Security Posture** (guardrail events, threat analysis, PII handling)
5. **Data Handling Assessment** (PII redaction rate, data types processed)
6. **Audit Trail Integrity** (HMAC-signed events in MinIO, 90-day retention)
7. **Risk Assessment** (LOW / MEDIUM / HIGH with justification)
8. **Recommendations** (specific, actionable items)
9. **Compliance Declaration** (formal sign-off statement with date)

Format as clean Markdown. Use tables where appropriate. Be precise with numbers."""

        report_md = chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model="gemini-3.1-pro",
            reasoning_effort="medium",
        )

        with registry_db._cursor() as cur:
            cur.execute("""
                UPDATE compliance_reports
                SET status='complete', report_md=%s
                WHERE report_id=%s
            """, (report_md, report_id))

    except Exception as e:
        with registry_db._cursor() as cur:
            cur.execute("""
                UPDATE compliance_reports
                SET status='failed', report_md=%s
                WHERE report_id=%s
            """, (f"Report generation failed: {e}", report_id))


@router.post("/{name}/compliance-report")
def generate_report(name: str, body: ReportRequest, request: Request):
    """Kick off async compliance report generation. Returns report_id to poll."""
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")

    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    report_id = f"report-{uuid.uuid4().hex[:12]}"
    since = datetime.now(timezone.utc) - timedelta(days=body.period_days)

    # Gather data synchronously (fast — DB queries only)
    data = _gather_agent_data(name, since)
    data["agent"] = {**agent, "domain": agent.get("domain", ""), "subdomain": agent.get("subdomain", "")}

    # Create DB record
    with registry_db._cursor() as cur:
        cur.execute("""
            INSERT INTO compliance_reports
              (report_id, agent_name, generated_by, period_start, period_end, status)
            VALUES (%s, %s, %s, %s, %s, 'generating')
        """, (
            report_id, name, actor,
            since.isoformat(),
            datetime.now(timezone.utc).isoformat(),
        ))

    # Generate in background thread so we don't block the HTTP response
    thread = threading.Thread(
        target=_generate_report_async,
        args=(report_id, name, data, body.notes),
        daemon=True,
    )
    thread.start()

    return {
        "report_id": report_id,
        "agent_name": name,
        "status": "generating",
        "period_days": body.period_days,
        "message": f"Report generation started. Poll GET /agents/{name}/compliance-report/{report_id} for status.",
    }


@router.get("/{name}/compliance-reports")
def list_reports(name: str, limit: int = Query(10, ge=1, le=50)):
    """List compliance reports for an agent, newest first."""
    with registry_db._cursor() as cur:
        cur.execute("""
            SELECT report_id, agent_name, generated_by, period_start, period_end,
                   status, created_at,
                   CASE WHEN report_md IS NOT NULL THEN TRUE ELSE FALSE END as has_content
            FROM compliance_reports
            WHERE agent_name=%s
            ORDER BY created_at DESC
            LIMIT %s
        """, (name, limit))
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            for k in ("period_start", "period_end", "created_at"):
                if d.get(k):
                    d[k] = d[k].isoformat()
            rows.append(d)
    return {"reports": rows, "agent_name": name}


@router.get("/{name}/compliance-report/{report_id}")
def get_report(name: str, report_id: str):
    """Get a specific compliance report by ID (polls for status)."""
    with registry_db._cursor() as cur:
        cur.execute("""
            SELECT * FROM compliance_reports
            WHERE report_id=%s AND agent_name=%s
        """, (report_id, name))
        row = cur.fetchone()

    if not row:
        raise HTTPException(404, f"Report '{report_id}' not found for agent '{name}'")

    d = dict(row)
    for k in ("period_start", "period_end", "created_at"):
        if d.get(k):
            d[k] = d[k].isoformat()
    return d
