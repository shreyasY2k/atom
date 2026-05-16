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
               agent_role_name, description, version_count, skills, created_at)
            VALUES
              (%(name)s, %(version)s, %(service_account_id)s, %(virtual_key)s, %(owner)s,
               %(deployed_at)s, %(endpoint)s, %(container_id)s, %(spec_hash)s, %(code_hash)s, %(status)s,
               %(agent_role_name)s, %(description)s, %(version_count)s, %(skills)s::jsonb, %(created_at)s)
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
              created_at=COALESCE(agents.created_at, EXCLUDED.created_at)
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
    }
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO tools
              (tool_id, name, display_name, description, scope, owner_agent,
               tool_type, endpoint, method, code, mcp_server_url, mcp_transport, mcp_tool_names,
               auth_type, auth_config, input_schema, output_schema, tags,
               created_by, created_at, updated_at)
            VALUES
              (%(tool_id)s, %(name)s, %(display_name)s, %(description)s, %(scope)s, %(owner_agent)s,
               %(tool_type)s, %(endpoint)s, %(method)s, %(code)s,
               %(mcp_server_url)s, %(mcp_transport)s, %(mcp_tool_names)s::jsonb,
               %(auth_type)s, %(auth_config)s::jsonb,
               %(input_schema)s::jsonb, %(output_schema)s::jsonb, %(tags)s::jsonb,
               %(created_by)s, %(created_at)s, %(updated_at)s)
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


def list_tools(scope: str | None = None, owner_agent: str | None = None) -> list[dict]:
    with _cursor() as cur:
        if scope and owner_agent:
            cur.execute(
                "SELECT * FROM tools WHERE scope=%s AND owner_agent=%s ORDER BY created_at DESC",
                (scope, owner_agent),
            )
        elif scope:
            cur.execute(
                "SELECT * FROM tools WHERE scope=%s ORDER BY created_at DESC",
                (scope,),
            )
        elif owner_agent:
            cur.execute(
                "SELECT * FROM tools WHERE owner_agent=%s ORDER BY created_at DESC",
                (owner_agent,),
            )
        else:
            cur.execute("SELECT * FROM tools ORDER BY created_at DESC")
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
