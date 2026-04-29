"""
/api/audit — paginated audit log reader + chain-integrity verifier.

The hash chain is written by GATE (chain.go) using:
  HMAC = HMAC-SHA256(PLATFORM_HMAC_SECRET, prev_hash_bytes || event_json_bytes)
  prev_hash = SHA256(previous event JSON bytes)  or "genesis" for row 1

Verification note: GATE stores the event as JSONB, which may reorder keys
relative to the original JSON bytes used for HMAC computation. The verify
endpoint recomputes HMAC against the JSONB-round-tripped representation; a
mismatch indicates either a tampered entry OR a key-order difference between
Go json.Marshal and Postgres JSONB. A future migration adding an event_raw
text column would eliminate the ambiguity.
"""

import hashlib
import hmac as _hmac_mod
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth.middleware import require_auth
from ..database import get_conn

router = APIRouter()

_SECRET = os.environ.get("PLATFORM_HMAC_SECRET", "").encode()


def _hmac_hex(secret: bytes, prev_hash: str, event_bytes: bytes) -> str:
    h = _hmac_mod.new(secret, digestmod=hashlib.sha256)
    h.update(prev_hash.encode())
    h.update(event_bytes)
    return h.hexdigest()


def _event_bytes(event) -> bytes:
    if isinstance(event, (dict, list)):
        return json.dumps(event, separators=(",", ":"), sort_keys=True).encode()
    return json.dumps(json.loads(event), separators=(",", ":"), sort_keys=True).encode()


@router.get("/")
async def list_audit_log(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    _: dict = Depends(require_auth),
):
    offset = (page - 1) * page_size
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT seq, prev_hash, event, hmac, created_at
            FROM audit_log_chain
            ORDER BY seq DESC
            LIMIT $1 OFFSET $2
            """,
            page_size,
            offset,
        )
        total = await conn.fetchval("SELECT COUNT(*) FROM audit_log_chain")

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [
            {
                "seq": r["seq"],
                "prev_hash": r["prev_hash"],
                "event": r["event"],
                "hmac": r["hmac"],
                "created_at": r["created_at"].isoformat(),
            }
            for r in rows
        ],
    }


@router.post("/verify")
async def verify_chain(
    n: int = Query(100, ge=1, le=10000),
    _: dict = Depends(require_auth),
):
    if not _SECRET:
        raise HTTPException(
            status_code=503,
            detail="PLATFORM_HMAC_SECRET not configured — cannot verify chain",
        )

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT seq, prev_hash, event, hmac
            FROM audit_log_chain
            ORDER BY seq ASC
            LIMIT $1
            """,
            n,
        )

    if not rows:
        return {"valid": True, "checked": 0, "message": "no entries in audit log"}

    entries = list(rows)

    for i, entry in enumerate(entries):
        eb = _event_bytes(entry["event"])
        expected_mac = _hmac_hex(_SECRET, entry["prev_hash"], eb)

        if expected_mac != entry["hmac"]:
            return {
                "valid": False,
                "checked": i + 1,
                "first_invalid_seq": entry["seq"],
                "reason": "HMAC mismatch (possible tampering or JSON key-order difference)",
            }

        if i > 0:
            prev_eb = _event_bytes(entries[i - 1]["event"])
            expected_prev = hashlib.sha256(prev_eb).hexdigest()
            if expected_prev != entry["prev_hash"]:
                return {
                    "valid": False,
                    "checked": i + 1,
                    "first_invalid_seq": entry["seq"],
                    "reason": "prev_hash mismatch — chain link broken",
                }

    return {
        "valid": True,
        "checked": len(entries),
        "message": f"all {len(entries)} entries verified",
    }
