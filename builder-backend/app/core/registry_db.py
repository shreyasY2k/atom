"""PostgreSQL-backed agent registry."""

import json
import os
from contextlib import contextmanager

import psycopg2
import psycopg2.extras

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://atom:atom@platform-db:5432/atom",
)


def _init():
    with _cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                name               TEXT PRIMARY KEY,
                version            TEXT NOT NULL,
                service_account_id TEXT NOT NULL,
                virtual_key        TEXT NOT NULL,
                owner              TEXT NOT NULL DEFAULT 'user:default@atom.io',
                deployed_at        TEXT NOT NULL,
                endpoint           TEXT,
                container_id       TEXT,
                spec_hash          TEXT,
                code_hash          TEXT,
                status             TEXT NOT NULL DEFAULT 'deployed',
                agent_role_name    TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_runs (
                run_id             TEXT PRIMARY KEY,
                agent_name         TEXT NOT NULL,
                service_account_id TEXT NOT NULL,
                started_at         TEXT NOT NULL,
                completed_at       TEXT,
                status             TEXT NOT NULL DEFAULT 'running',
                user_message       TEXT,
                agent_response     TEXT
            )
        """)
        # New columns on agents (safe: IF NOT EXISTS)
        cur.execute("ALTER TABLE agents ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''")
        cur.execute("ALTER TABLE agents ADD COLUMN IF NOT EXISTS version_count INTEGER DEFAULT 0")
        cur.execute("ALTER TABLE agents ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'")
        cur.execute("ALTER TABLE agents ADD COLUMN IF NOT EXISTS created_at TEXT")
        cur.execute("ALTER TABLE agents ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT ''")
        cur.execute("ALTER TABLE agents ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT ''")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS tools (
                tool_id      TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                display_name TEXT,
                description  TEXT,
                scope        TEXT NOT NULL DEFAULT 'global',
                owner_agent  TEXT,
                endpoint     TEXT,
                method       TEXT DEFAULT 'POST',
                input_schema JSONB DEFAULT '{}',
                output_schema JSONB DEFAULT '{}',
                tags         JSONB DEFAULT '[]',
                created_by   TEXT,
                created_at   TEXT,
                updated_at   TEXT
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_tools (
                agent_name TEXT NOT NULL,
                tool_id    TEXT NOT NULL,
                PRIMARY KEY (agent_name, tool_id)
            )
        """)
        # Tool type expansion — ALTER after CREATE TABLE so table exists
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS tool_type TEXT DEFAULT 'http'")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS code TEXT")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS mcp_server_url TEXT")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS mcp_transport TEXT DEFAULT 'sse'")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS mcp_tool_names JSONB DEFAULT '[]'")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS auth_config JSONB DEFAULT '{}'")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'none'")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS domain TEXT DEFAULT ''")
        cur.execute("ALTER TABLE tools ADD COLUMN IF NOT EXISTS subdomain TEXT DEFAULT ''")


@contextmanager
def _cursor():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            yield cur
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def upsert(record: dict) -> None:
    rec = {
        "agent_role_name": None,
        "description": "",
        "version_count": 0,
        "skills": [],
        "created_at": None,
        "domain": "",
        "subdomain": "",
        **record,
    }
    # Serialize skills to JSON string for psycopg2
    if isinstance(rec.get("skills"), list):
        rec["skills"] = json.dumps(rec["skills"])
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO agents
              (name, version, service_account_id, virtual_key, owner,
               deployed_at, endpoint, container_id, spec_hash, code_hash, status,
               agent_role_name, description, version_count, skills, created_at,
               domain, subdomain)
            VALUES
              (%(name)s, %(version)s, %(service_account_id)s, %(virtual_key)s, %(owner)s,
               %(deployed_at)s, %(endpoint)s, %(container_id)s, %(spec_hash)s, %(code_hash)s, %(status)s,
               %(agent_role_name)s, %(description)s, %(version_count)s, %(skills)s::jsonb, %(created_at)s,
               %(domain)s, %(subdomain)s)
            ON CONFLICT (name) DO UPDATE SET
              version=EXCLUDED.version,
              service_account_id=EXCLUDED.service_account_id,
              virtual_key=EXCLUDED.virtual_key,
              deployed_at=EXCLUDED.deployed_at,
              endpoint=EXCLUDED.endpoint,
              container_id=EXCLUDED.container_id,
              spec_hash=EXCLUDED.spec_hash,
              code_hash=EXCLUDED.code_hash,
              status=EXCLUDED.status,
              agent_role_name=COALESCE(EXCLUDED.agent_role_name, agents.agent_role_name),
              description=COALESCE(EXCLUDED.description, agents.description),
              version_count=COALESCE(EXCLUDED.version_count, agents.version_count),
              skills=COALESCE(EXCLUDED.skills, agents.skills),
              created_at=COALESCE(agents.created_at, EXCLUDED.created_at),
              domain=CASE WHEN EXCLUDED.domain != '' THEN EXCLUDED.domain ELSE agents.domain END,
              subdomain=CASE WHEN EXCLUDED.subdomain != '' THEN EXCLUDED.subdomain ELSE agents.subdomain END
        """, rec)


def get(name: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT * FROM agents WHERE name=%s", (name,))
        row = cur.fetchone()
        if row is None:
            return None
        d = dict(row)
        # Deserialize JSONB fields
        if isinstance(d.get("skills"), str):
            try:
                d["skills"] = json.loads(d["skills"])
            except Exception:
                d["skills"] = []
        elif d.get("skills") is None:
            d["skills"] = []
        return d


def list_all() -> list[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM agents ORDER BY deployed_at DESC")
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if isinstance(d.get("skills"), str):
                try:
                    d["skills"] = json.loads(d["skills"])
                except Exception:
                    d["skills"] = []
            elif d.get("skills") is None:
                d["skills"] = []
            rows.append(d)
        return rows


def set_agent_role_name(name: str, role_name: str) -> None:
    with _cursor() as cur:
        cur.execute("UPDATE agents SET agent_role_name=%s WHERE name=%s", (role_name, name))


def mark_undeployed(name: str) -> None:
    with _cursor() as cur:
        cur.execute("UPDATE agents SET status='undeployed' WHERE name=%s", (name,))


def upsert_run(run: dict) -> None:
    rec = {"user_message": None, "agent_response": None, **run}
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO agent_runs (run_id, agent_name, service_account_id, started_at,
                                    completed_at, status, user_message, agent_response)
            VALUES (%(run_id)s, %(agent_name)s, %(service_account_id)s, %(started_at)s,
                    %(completed_at)s, %(status)s, %(user_message)s, %(agent_response)s)
            ON CONFLICT (run_id) DO UPDATE SET
              completed_at=EXCLUDED.completed_at,
              status=EXCLUDED.status,
              user_message=COALESCE(EXCLUDED.user_message, agent_runs.user_message),
              agent_response=COALESCE(EXCLUDED.agent_response, agent_runs.agent_response)
        """, rec)


def get_run(run_id: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT * FROM agent_runs WHERE run_id=%s", (run_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_runs(agent_name: str, limit: int = 50) -> list[dict]:
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM agent_runs WHERE agent_name=%s ORDER BY started_at DESC LIMIT %s",
            (agent_name, limit),
        )
        return [dict(r) for r in cur.fetchall()]


def list_all_runs(limit: int = 200) -> list[dict]:
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT %s",
            (limit,),
        )
        return [dict(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Tools registry
# ---------------------------------------------------------------------------

def upsert_tool(tool: dict) -> None:
    """Insert or update a tool record."""
    rec = {
        "tool_id": tool["tool_id"],
        "name": tool.get("name", ""),
        "display_name": tool.get("display_name"),
        "description": tool.get("description", ""),
        "scope": tool.get("scope", "global"),
        "owner_agent": tool.get("owner_agent"),
        "tool_type": tool.get("tool_type", "http"),
        "endpoint": tool.get("endpoint"),
        "method": tool.get("method", "POST"),
        "code": tool.get("code"),
        "mcp_server_url": tool.get("mcp_server_url"),
        "mcp_transport": tool.get("mcp_transport", "sse"),
        "mcp_tool_names": json.dumps(tool.get("mcp_tool_names") or []),
        "auth_type": tool.get("auth_type", "none"),
        "auth_config": json.dumps(tool.get("auth_config") or {}),
        "input_schema": json.dumps(tool.get("input_schema") or {}),
        "output_schema": json.dumps(tool.get("output_schema") or {}),
        "tags": json.dumps(tool.get("tags") or []),
        "created_by": tool.get("created_by"),
        "created_at": tool.get("created_at"),
        "updated_at": tool.get("updated_at"),
        "domain": tool.get("domain", ""),
        "subdomain": tool.get("subdomain", ""),
    }
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO tools
              (tool_id, name, display_name, description, scope, owner_agent,
               tool_type, endpoint, method, code, mcp_server_url, mcp_transport, mcp_tool_names,
               auth_type, auth_config, input_schema, output_schema, tags,
               created_by, created_at, updated_at, domain, subdomain)
            VALUES
              (%(tool_id)s, %(name)s, %(display_name)s, %(description)s, %(scope)s, %(owner_agent)s,
               %(tool_type)s, %(endpoint)s, %(method)s, %(code)s,
               %(mcp_server_url)s, %(mcp_transport)s, %(mcp_tool_names)s::jsonb,
               %(auth_type)s, %(auth_config)s::jsonb,
               %(input_schema)s::jsonb, %(output_schema)s::jsonb, %(tags)s::jsonb,
               %(created_by)s, %(created_at)s, %(updated_at)s, %(domain)s, %(subdomain)s)
            ON CONFLICT (tool_id) DO UPDATE SET
              name=EXCLUDED.name,
              display_name=EXCLUDED.display_name,
              description=EXCLUDED.description,
              scope=EXCLUDED.scope,
              owner_agent=EXCLUDED.owner_agent,
              tool_type=EXCLUDED.tool_type,
              endpoint=EXCLUDED.endpoint,
              method=EXCLUDED.method,
              code=EXCLUDED.code,
              mcp_server_url=EXCLUDED.mcp_server_url,
              mcp_transport=EXCLUDED.mcp_transport,
              mcp_tool_names=EXCLUDED.mcp_tool_names,
              auth_type=EXCLUDED.auth_type,
              auth_config=EXCLUDED.auth_config,
              input_schema=EXCLUDED.input_schema,
              output_schema=EXCLUDED.output_schema,
              tags=EXCLUDED.tags,
              created_by=COALESCE(tools.created_by, EXCLUDED.created_by),
              created_at=COALESCE(tools.created_at, EXCLUDED.created_at),
              updated_at=EXCLUDED.updated_at
        """, rec)


def _row_to_tool(row: dict) -> dict:
    """Deserialize JSONB fields in a tool row."""
    d = dict(row)
    for field in ("input_schema", "output_schema", "auth_config"):
        val = d.get(field)
        if isinstance(val, str):
            try:
                d[field] = json.loads(val)
            except Exception:
                d[field] = {}
        elif val is None:
            d[field] = {}
    for field in ("tags", "mcp_tool_names"):
        val = d.get(field)
        if isinstance(val, str):
            try:
                d[field] = json.loads(val)
            except Exception:
                d[field] = []
        elif val is None:
            d[field] = []
    return d


def get_tool(tool_id: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT * FROM tools WHERE tool_id=%s", (tool_id,))
        row = cur.fetchone()
        return _row_to_tool(row) if row else None


def list_agents(domain: str | None = None, subdomain: str | None = None) -> list[dict]:
    """Return agents, optionally filtered by domain and/or subdomain."""
    with _cursor() as cur:
        clauses, params = [], []
        if domain:
            clauses.append("domain=%s"); params.append(domain)
        if subdomain:
            clauses.append("subdomain=%s"); params.append(subdomain)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        cur.execute(f"SELECT * FROM agents {where} ORDER BY deployed_at DESC", params)
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if isinstance(d.get("skills"), str):
                try: d["skills"] = json.loads(d["skills"])
                except Exception: d["skills"] = []
            elif d.get("skills") is None:
                d["skills"] = []
            rows.append(d)
        return rows


def get_domain_taxonomy() -> list[dict]:
    """Return all known domain/subdomain pairs from agents and tools tables."""
    with _cursor() as cur:
        cur.execute("""
            SELECT DISTINCT domain, subdomain
            FROM (
                SELECT domain, subdomain FROM agents WHERE domain != ''
                UNION ALL
                SELECT domain, subdomain FROM tools WHERE domain != ''
            ) combined
            WHERE domain != ''
            ORDER BY domain, subdomain
        """)
        rows = [dict(r) for r in cur.fetchall()]

    # Build structured domain → subdomains map
    taxonomy: dict[str, set] = {}
    for row in rows:
        d = row["domain"]
        sd = row.get("subdomain") or ""
        if d not in taxonomy:
            taxonomy[d] = set()
        if sd:
            taxonomy[d].add(sd)

    return [
        {"domain": d, "subdomains": sorted(list(sds))}
        for d, sds in sorted(taxonomy.items())
    ]


def list_tools(scope: str | None = None, owner_agent: str | None = None, domain: str | None = None, subdomain: str | None = None) -> list[dict]:
    with _cursor() as cur:
        clauses, params = [], []
        if scope:
            clauses.append("scope=%s"); params.append(scope)
        if owner_agent:
            clauses.append("owner_agent=%s"); params.append(owner_agent)
        if domain:
            clauses.append("domain=%s"); params.append(domain)
        if subdomain:
            clauses.append("subdomain=%s"); params.append(subdomain)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        cur.execute(f"SELECT * FROM tools {where} ORDER BY domain, created_at DESC", params)
        return [_row_to_tool(r) for r in cur.fetchall()]


def delete_tool(tool_id: str) -> None:
    with _cursor() as cur:
        # Remove all agent associations first
        cur.execute("DELETE FROM agent_tools WHERE tool_id=%s", (tool_id,))
        cur.execute("DELETE FROM tools WHERE tool_id=%s", (tool_id,))


def associate_tool(agent_name: str, tool_id: str) -> None:
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO agent_tools (agent_name, tool_id)
            VALUES (%s, %s)
            ON CONFLICT (agent_name, tool_id) DO NOTHING
        """, (agent_name, tool_id))


def dissociate_tool(agent_name: str, tool_id: str) -> None:
    with _cursor() as cur:
        cur.execute(
            "DELETE FROM agent_tools WHERE agent_name=%s AND tool_id=%s",
            (agent_name, tool_id),
        )


def get_agent_tools(agent_name: str) -> list[dict]:
    """Return tool objects for all tools associated with this agent."""
    with _cursor() as cur:
        cur.execute("""
            SELECT t.*
            FROM tools t
            JOIN agent_tools at ON at.tool_id = t.tool_id
            WHERE at.agent_name = %s
            ORDER BY t.created_at DESC
        """, (agent_name,))
        return [_row_to_tool(r) for r in cur.fetchall()]


# ---------------------------------------------------------------------------
# Agent metadata helpers
# ---------------------------------------------------------------------------

def update_skills(agent_name: str, skills: list) -> None:
    """Update the skills JSONB column for an agent."""
    with _cursor() as cur:
        cur.execute(
            "UPDATE agents SET skills=%s::jsonb WHERE name=%s",
            (json.dumps(skills), agent_name),
        )


def update_description(agent_name: str, description: str, version_count: int) -> None:
    """Update description and version_count for an agent."""
    with _cursor() as cur:
        cur.execute(
            "UPDATE agents SET description=%s, version_count=%s WHERE name=%s",
            (description, version_count, agent_name),
        )


_init()


# ---------------------------------------------------------------------------
# Security / Command Center tables
# ---------------------------------------------------------------------------

def _init_security():
    with _cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS llm_call_events (
                id                  SERIAL PRIMARY KEY,
                gate_run_id         TEXT NOT NULL,
                service_account_id  TEXT,
                model               TEXT,
                path                TEXT,
                status_code         INTEGER,
                latency_ms          BIGINT,
                created_at          TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS llm_call_events_svc_idx
            ON llm_call_events (service_account_id, created_at)
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS guardrail_events (
                id                  SERIAL PRIMARY KEY,
                gate_run_id         TEXT,
                service_account_id  TEXT,
                agent_name          TEXT,
                layer               TEXT NOT NULL,
                phase               TEXT NOT NULL,
                verdict             TEXT NOT NULL,
                threat_type         TEXT,
                threat_level        TEXT,
                pii_types           TEXT,
                created_at          TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS guardrail_events_svc_idx
            ON guardrail_events (service_account_id, created_at)
        """)


_init_security()


def get_command_center_overview(hours: int = 24) -> dict:
    """Aggregate platform-wide stats for the command center overview panel."""
    with _cursor() as cur:
        cur.execute("""
            SELECT
                COUNT(*) AS total_calls,
                COUNT(*) FILTER (WHERE status_code >= 400) AS failed_calls,
                ROUND(AVG(latency_ms)) AS avg_latency_ms,
                ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms)) AS p95_latency_ms
            FROM llm_call_events
            WHERE created_at >= NOW() - INTERVAL '%s hours'
        """, (hours,))
        row = cur.fetchone()
        overview = dict(row) if row else {}

        cur.execute("""
            SELECT COUNT(*) AS total_blocks
            FROM guardrail_events
            WHERE verdict = 'deny'
              AND created_at >= NOW() - INTERVAL '%s hours'
        """, (hours,))
        block_row = cur.fetchone()
        overview['total_blocks'] = (block_row or {}).get('total_blocks', 0)

        cur.execute("""
            SELECT COUNT(*) AS pii_events
            FROM guardrail_events
            WHERE layer = 'L2-PII'
              AND created_at >= NOW() - INTERVAL '%s hours'
        """, (hours,))
        pii_row = cur.fetchone()
        overview['pii_events'] = (pii_row or {}).get('pii_events', 0)

        cur.execute("SELECT COUNT(*) AS active_agents FROM agents WHERE status='deployed'")
        agents_row = cur.fetchone()
        overview['active_agents'] = (agents_row or {}).get('active_agents', 0)

    return {k: (int(v) if v is not None else 0) for k, v in overview.items()}


def get_per_agent_stats(hours: int = 24) -> list[dict]:
    """Per-agent LLM call stats joined with the agents registry."""
    with _cursor() as cur:
        cur.execute("""
            SELECT
                a.name AS agent_name,
                a.status,
                a.service_account_id,
                COUNT(l.id) AS call_count,
                COALESCE(ROUND(AVG(l.latency_ms)), 0) AS avg_latency_ms,
                COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY l.latency_ms)), 0) AS p95_latency_ms,
                COUNT(l.id) FILTER (WHERE l.status_code >= 400) AS error_count
            FROM agents a
            LEFT JOIN llm_call_events l
                ON l.service_account_id = a.service_account_id
                AND l.created_at >= NOW() - INTERVAL '%s hours'
            GROUP BY a.name, a.status, a.service_account_id
            ORDER BY COUNT(l.id) DESC
        """, (hours,))
        rows = [dict(r) for r in cur.fetchall()]

        # Attach guardrail stats per agent
        for row in rows:
            cur.execute("""
                SELECT
                    COUNT(*) FILTER (WHERE verdict = 'deny') AS blocks,
                    COUNT(*) FILTER (WHERE verdict = 'redact') AS redactions,
                    COUNT(*) AS total_events
                FROM guardrail_events
                WHERE service_account_id = %s
                  AND created_at >= NOW() - INTERVAL '%s hours'
            """, (row['service_account_id'], hours))
            g = cur.fetchone()
            row['guardrail_blocks'] = int((g or {}).get('blocks', 0) or 0)
            row['pii_redactions'] = int((g or {}).get('redactions', 0) or 0)
            row['guardrail_events'] = int((g or {}).get('total_events', 0) or 0)

        return rows


def get_guardrail_layer_stats(hours: int = 24) -> list[dict]:
    """Per-layer guardrail event counts for the 10-layer security grid."""
    with _cursor() as cur:
        cur.execute("""
            SELECT
                layer,
                COUNT(*) AS total_events,
                COUNT(*) FILTER (WHERE verdict = 'deny') AS blocks,
                COUNT(*) FILTER (WHERE verdict = 'redact') AS redactions,
                MAX(created_at) AS last_event
            FROM guardrail_events
            WHERE created_at >= NOW() - INTERVAL '%s hours'
            GROUP BY layer
            ORDER BY layer
        """, (hours,))
        return [dict(r) for r in cur.fetchall()]


def _init_compliance():
    with _cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS compliance_reports (
                id           SERIAL PRIMARY KEY,
                report_id    TEXT NOT NULL UNIQUE,
                agent_name   TEXT NOT NULL,
                generated_by TEXT NOT NULL,
                period_start TIMESTAMPTZ,
                period_end   TIMESTAMPTZ,
                status       TEXT NOT NULL DEFAULT 'generating',
                report_md    TEXT,
                created_at   TIMESTAMPTZ DEFAULT NOW()
            )
        """)


_init_compliance()


def get_timeseries(hours: int = 24) -> dict:
    """Hourly bucketed call volume, error counts, and latency percentiles."""
    with _cursor() as cur:
        cur.execute("""
            WITH buckets AS (
                SELECT generate_series(
                    DATE_TRUNC('hour', NOW() - INTERVAL '%s hours'),
                    DATE_TRUNC('hour', NOW()),
                    INTERVAL '1 hour'
                ) AS bucket
            )
            SELECT
                TO_CHAR(b.bucket, 'HH24:MI') AS hour,
                b.bucket AS bucket_ts,
                COUNT(l.id) AS calls,
                COUNT(l.id) FILTER (WHERE l.status_code >= 400) AS errors,
                COALESCE(ROUND(AVG(l.latency_ms)), 0) AS avg_latency,
                COALESCE(ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY l.latency_ms)), 0) AS p50,
                COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY l.latency_ms)), 0) AS p95,
                COALESCE(ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY l.latency_ms)), 0) AS p99
            FROM buckets b
            LEFT JOIN llm_call_events l
                ON DATE_TRUNC('hour', l.created_at) = b.bucket
            GROUP BY b.bucket
            ORDER BY b.bucket
        """, (hours,))

        calls_series, latency_series = [], []
        for row in cur.fetchall():
            d = dict(row)
            bucket_ts = d.get('bucket_ts')
            label = d['hour']
            calls_series.append({
                'time': label,
                'calls': int(d.get('calls') or 0),
                'errors': int(d.get('errors') or 0),
            })
            latency_series.append({
                'time': label,
                'p50':  int(d.get('p50') or 0),
                'p95':  int(d.get('p95') or 0),
                'p99':  int(d.get('p99') or 0),
            })

        cur.execute("""
            WITH buckets AS (
                SELECT generate_series(
                    DATE_TRUNC('hour', NOW() - INTERVAL '%s hours'),
                    DATE_TRUNC('hour', NOW()),
                    INTERVAL '1 hour'
                ) AS bucket
            )
            SELECT
                TO_CHAR(b.bucket, 'HH24:MI') AS hour,
                COUNT(g.id) FILTER (WHERE g.verdict = 'deny') AS blocks,
                COUNT(g.id) FILTER (WHERE g.verdict = 'redact') AS redactions
            FROM buckets b
            LEFT JOIN guardrail_events g
                ON DATE_TRUNC('hour', g.created_at) = b.bucket
            GROUP BY b.bucket
            ORDER BY b.bucket
        """, (hours,))

        guardrail_series = [
            {'time': row['hour'], 'blocks': int(row.get('blocks') or 0), 'redactions': int(row.get('redactions') or 0)}
            for row in (dict(r) for r in cur.fetchall())
        ]

        # Layer distribution (all time)
        cur.execute("""
            SELECT layer, COUNT(*) AS n
            FROM guardrail_events
            WHERE verdict IN ('deny','redact')
              AND created_at >= NOW() - INTERVAL '%s hours'
            GROUP BY layer
            ORDER BY COUNT(*) DESC
        """, (hours,))
        layer_dist = [{'layer': row['layer'], 'events': int(row['n'])} for row in (dict(r) for r in cur.fetchall())]

    return {
        'calls': calls_series,
        'latency': latency_series,
        'guardrails': guardrail_series,
        'layer_dist': layer_dist,
    }


def get_recent_guardrail_events(limit: int = 50) -> list[dict]:
    """Most recent guardrail events across all agents."""
    with _cursor() as cur:
        cur.execute("""
            SELECT
                g.id, g.layer, g.phase, g.verdict, g.threat_type,
                g.threat_level, g.pii_types, g.created_at,
                a.name AS agent_name
            FROM guardrail_events g
            LEFT JOIN agents a ON a.service_account_id = g.service_account_id
            ORDER BY g.created_at DESC
            LIMIT %s
        """, (limit,))
        rows = []
        for r in cur.fetchall():
            d = dict(r)
            if d.get('created_at'):
                d['created_at'] = d['created_at'].isoformat()
            rows.append(d)
        return rows


# ---------------------------------------------------------------------------
# Session tables
# ---------------------------------------------------------------------------

def _init_sessions():
    with _cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS agent_sessions (
                session_id   TEXT PRIMARY KEY,
                agent_name   TEXT NOT NULL,
                owner        TEXT NOT NULL,
                created_at   TEXT NOT NULL,
                updated_at   TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'active',
                reme_context TEXT,
                metadata     JSONB DEFAULT '{}'
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS session_messages (
                message_id   TEXT PRIMARY KEY,
                session_id   TEXT NOT NULL,
                role         TEXT NOT NULL,
                content      TEXT NOT NULL,
                created_at   TEXT NOT NULL,
                run_id       TEXT,
                metadata     JSONB DEFAULT '{}'
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS session_messages_session_idx
            ON session_messages (session_id, created_at)
        """)


def create_session(session: dict) -> dict:
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO agent_sessions
              (session_id, agent_name, owner, created_at, updated_at, status, reme_context, metadata)
            VALUES
              (%(session_id)s, %(agent_name)s, %(owner)s, %(created_at)s, %(updated_at)s,
               %(status)s, %(reme_context)s, %(metadata)s::jsonb)
        """, {
            "session_id": session["session_id"],
            "agent_name": session["agent_name"],
            "owner": session["owner"],
            "created_at": session["created_at"],
            "updated_at": session["updated_at"],
            "status": session.get("status", "active"),
            "reme_context": session.get("reme_context"),
            "metadata": json.dumps(session.get("metadata") or {}),
        })
    return get_session(session["session_id"])


def get_session(session_id: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT * FROM agent_sessions WHERE session_id=%s", (session_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_sessions(agent_name: str, owner: str | None = None, limit: int = 50) -> list[dict]:
    with _cursor() as cur:
        if owner:
            cur.execute(
                "SELECT * FROM agent_sessions WHERE agent_name=%s AND owner=%s ORDER BY updated_at DESC LIMIT %s",
                (agent_name, owner, limit),
            )
        else:
            cur.execute(
                "SELECT * FROM agent_sessions WHERE agent_name=%s ORDER BY updated_at DESC LIMIT %s",
                (agent_name, limit),
            )
        return [dict(r) for r in cur.fetchall()]


def update_session_status(session_id: str, status: str, updated_at: str) -> None:
    with _cursor() as cur:
        cur.execute(
            "UPDATE agent_sessions SET status=%s, updated_at=%s WHERE session_id=%s",
            (status, updated_at, session_id),
        )


def append_message(msg: dict) -> dict:
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO session_messages
              (message_id, session_id, role, content, created_at, run_id, metadata)
            VALUES
              (%(message_id)s, %(session_id)s, %(role)s, %(content)s, %(created_at)s,
               %(run_id)s, %(metadata)s::jsonb)
        """, {
            "message_id": msg["message_id"],
            "session_id": msg["session_id"],
            "role": msg["role"],
            "content": msg["content"],
            "created_at": msg["created_at"],
            "run_id": msg.get("run_id"),
            "metadata": json.dumps(msg.get("metadata") or {}),
        })
        # bump session updated_at
        cur.execute(
            "UPDATE agent_sessions SET updated_at=%s WHERE session_id=%s",
            (msg["created_at"], msg["session_id"]),
        )
    return msg


def get_session_messages(session_id: str) -> list[dict]:
    with _cursor() as cur:
        cur.execute(
            "SELECT * FROM session_messages WHERE session_id=%s ORDER BY created_at ASC",
            (session_id,),
        )
        return [dict(r) for r in cur.fetchall()]


_init_sessions()
