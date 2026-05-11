"""PostgreSQL-backed workflow registry."""

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
            CREATE TABLE IF NOT EXISTS workflows (
                name          TEXT PRIMARY KEY,
                version       TEXT NOT NULL,
                domain        TEXT NOT NULL,
                task_queue    TEXT NOT NULL,
                registered_at TEXT NOT NULL,
                spec_hash     TEXT,
                status        TEXT NOT NULL DEFAULT 'registered'
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
    with _cursor() as cur:
        cur.execute("""
            INSERT INTO workflows (name, version, domain, task_queue, registered_at, spec_hash, status)
            VALUES (%(name)s, %(version)s, %(domain)s, %(task_queue)s, %(registered_at)s, %(spec_hash)s, %(status)s)
            ON CONFLICT (name) DO UPDATE SET
              version=EXCLUDED.version,
              domain=EXCLUDED.domain,
              task_queue=EXCLUDED.task_queue,
              registered_at=EXCLUDED.registered_at,
              spec_hash=EXCLUDED.spec_hash,
              status=EXCLUDED.status
        """, record)


def get(name: str) -> dict | None:
    with _cursor() as cur:
        cur.execute("SELECT * FROM workflows WHERE name=%s", (name,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_all() -> list[dict]:
    with _cursor() as cur:
        cur.execute("SELECT * FROM workflows ORDER BY registered_at DESC")
        return [dict(r) for r in cur.fetchall()]


_init()
