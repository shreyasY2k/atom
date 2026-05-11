"""PostgreSQL-backed agent registry."""

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
                owner              TEXT NOT NULL DEFAULT 'user:demo@atom.io',
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
    rec = {"agent_role_name": None, **record}
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO agents
              (name, version, service_account_id, virtual_key, owner,
               deployed_at, endpoint, container_id, spec_hash, code_hash, status,
               agent_role_name)
            VALUES
              (%(name)s, %(version)s, %(service_account_id)s, %(virtual_key)s, %(owner)s,
               %(deployed_at)s, %(endpoint)s, %(container_id)s, %(spec_hash)s, %(code_hash)s, %(status)s,
               %(agent_role_name)s)
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
              agent_role_name=COALESCE(EXCLUDED.agent_role_name, agents.agent_role_name)
        """, rec)


def get(name: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT * FROM agents WHERE name=%s", (name,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_all() -> list[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM agents ORDER BY deployed_at DESC")
        return [dict(r) for r in cur.fetchall()]


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


_init()
