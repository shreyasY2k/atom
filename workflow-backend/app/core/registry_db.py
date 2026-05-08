"""SQLite-backed workflow registry at /work/wf-registry.db."""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

_DB_PATH = Path(os.environ.get("WORK_DIR", "/work")) / "wf-registry.db"


def _init():
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workflows (
                name         TEXT PRIMARY KEY,
                version      TEXT NOT NULL,
                domain       TEXT NOT NULL,
                task_queue   TEXT NOT NULL,
                registered_at TEXT NOT NULL,
                spec_hash    TEXT,
                status       TEXT NOT NULL DEFAULT 'registered'
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
            INSERT INTO workflows (name, version, domain, task_queue, registered_at, spec_hash, status)
            VALUES (:name, :version, :domain, :task_queue, :registered_at, :spec_hash, :status)
            ON CONFLICT(name) DO UPDATE SET
              version=excluded.version, domain=excluded.domain,
              task_queue=excluded.task_queue, registered_at=excluded.registered_at,
              spec_hash=excluded.spec_hash, status=excluded.status
        """, record)


def get(name: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM workflows WHERE name=?", (name,)).fetchone()
        return dict(row) if row else None


def list_all() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM workflows ORDER BY registered_at DESC").fetchall()
        return [dict(r) for r in rows]


_init()
