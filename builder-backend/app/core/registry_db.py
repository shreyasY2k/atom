"""SQLite-backed agent registry at /work/registry.db."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

_DB_PATH = Path(os.environ.get("WORK_DIR", "/work")) / "registry.db"


def _init():
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agents (
                name               TEXT PRIMARY KEY,
                version            TEXT NOT NULL,
                service_account_id TEXT NOT NULL,
                virtual_key        TEXT NOT NULL,
                owner              TEXT NOT NULL DEFAULT 'user:demo@atom.demo',
                deployed_at        TEXT NOT NULL,
                endpoint           TEXT,
                container_id       TEXT,
                spec_hash          TEXT,
                code_hash          TEXT,
                status             TEXT NOT NULL DEFAULT 'deployed'
            )
        """)
        conn.execute("""
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
def _conn():
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def upsert(record: dict) -> None:
    with _conn() as conn:
        conn.execute("""
            INSERT INTO agents
              (name, version, service_account_id, virtual_key, owner,
               deployed_at, endpoint, container_id, spec_hash, code_hash, status,
               agent_role_name)
            VALUES
              (:name, :version, :service_account_id, :virtual_key, :owner,
               :deployed_at, :endpoint, :container_id, :spec_hash, :code_hash, :status,
               :agent_role_name)
            ON CONFLICT(name) DO UPDATE SET
              version=excluded.version,
              service_account_id=excluded.service_account_id,
              virtual_key=excluded.virtual_key,
              deployed_at=excluded.deployed_at,
              endpoint=excluded.endpoint,
              container_id=excluded.container_id,
              spec_hash=excluded.spec_hash,
              code_hash=excluded.code_hash,
              status=excluded.status,
              agent_role_name=COALESCE(excluded.agent_role_name, agents.agent_role_name)
        """, {"agent_role_name": None, **record})


def get(name: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM agents WHERE name=?", (name,)).fetchone()
        return dict(row) if row else None


def list_all() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM agents ORDER BY deployed_at DESC").fetchall()
        return [dict(r) for r in rows]


def set_agent_role_name(name: str, role_name: str) -> None:
    """Backfill the agent_role_name for an existing agent record."""
    with _conn() as conn:
        conn.execute("UPDATE agents SET agent_role_name=? WHERE name=?", (role_name, name))


def mark_undeployed(name: str) -> None:
    with _conn() as conn:
        conn.execute("UPDATE agents SET status='undeployed' WHERE name=?", (name,))


def upsert_run(run: dict) -> None:
    with _conn() as conn:
        conn.execute("""
            INSERT INTO agent_runs (run_id, agent_name, service_account_id, started_at, completed_at, status, user_message, agent_response)
            VALUES (:run_id, :agent_name, :service_account_id, :started_at, :completed_at, :status, :user_message, :agent_response)
            ON CONFLICT(run_id) DO UPDATE SET
              completed_at=excluded.completed_at,
              status=excluded.status,
              user_message=COALESCE(excluded.user_message, agent_runs.user_message),
              agent_response=COALESCE(excluded.agent_response, agent_runs.agent_response)
        """, {
            "user_message": None,
            "agent_response": None,
            **run,
        })


def get_run(run_id: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM agent_runs WHERE run_id=?", (run_id,)).fetchone()
        return dict(row) if row else None


def list_runs(agent_name: str, limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM agent_runs WHERE agent_name=? ORDER BY started_at DESC LIMIT ?",
            (agent_name, limit)
        ).fetchall()
        return [dict(r) for r in rows]


def list_all_runs(limit: int = 200) -> list[dict]:
    """List all runs across all agents, newest first."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def _migrate():
    """Add new columns to existing tables without breaking old installs."""
    with _conn() as conn:
        for sql in [
            "ALTER TABLE agents ADD COLUMN agent_role_name TEXT",
            "ALTER TABLE agent_runs ADD COLUMN user_message TEXT",
            "ALTER TABLE agent_runs ADD COLUMN agent_response TEXT",
        ]:
            try:
                conn.execute(sql)
            except Exception:
                pass  # column already exists


# Initialise on import
_init()
_migrate()
