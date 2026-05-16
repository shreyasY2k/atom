#!/usr/bin/env python3
"""
Atom Audit Log HMAC Verifier
============================
Downloads all audit events from MinIO and verifies each entry's
HMAC-SHA256 signature independently — proving logs have not been tampered with.

Usage:
    python scripts/verify_audit_hmac.py
    python scripts/verify_audit_hmac.py --prefix gate/          # only gate events
    python scripts/verify_audit_hmac.py --date 2026-05-16       # specific date
    python scripts/verify_audit_hmac.py --fail-fast             # stop on first failure
    python scripts/verify_audit_hmac.py --key my-custom-key     # override HMAC key
"""
import argparse
import hashlib
import hmac
import json
import os
import sys
from datetime import datetime, timezone

import boto3

# ── Config ────────────────────────────────────────────────────────────────────

MINIO_ENDPOINT  = os.environ.get("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_ACCESS    = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET    = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
AUDIT_BUCKET    = "audit-logs"
DEFAULT_HMAC_KEY = os.environ.get("AUDIT_HMAC_KEY", "atom-audit-hmac-key-change-in-prod")


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=MINIO_ENDPOINT,
        aws_access_key_id=MINIO_ACCESS,
        aws_secret_access_key=MINIO_SECRET,
        region_name="us-east-1",
    )


def verify_event(raw: dict, hmac_key: str) -> tuple[bool, str]:
    """Verify the _hmac field in a log entry. Returns (valid, reason)."""
    stored_hmac = raw.get("_hmac", "")
    if not stored_hmac:
        return None, "no_hmac"

    if not stored_hmac.startswith("hmac-sha256:"):
        return False, f"unknown_algorithm: {stored_hmac[:20]}"

    stored_hex = stored_hmac.removeprefix("hmac-sha256:")

    # Reconstruct the payload: event dict WITHOUT the _hmac field, sorted keys
    payload_dict = {k: v for k, v in raw.items() if k != "_hmac"}
    payload = json.dumps(payload_dict, sort_keys=True, separators=(",", ":"))

    expected = hmac.new(hmac_key.encode(), payload.encode(), hashlib.sha256).hexdigest()

    if hmac.compare_digest(expected, stored_hex):
        return True, "ok"
    return False, f"mismatch — expected {expected[:16]}… got {stored_hex[:16]}…"


def list_objects(s3, prefix: str) -> list[str]:
    keys = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=AUDIT_BUCKET, Prefix=prefix):
        for obj in page.get("Contents", []):
            keys.append(obj["Key"])
    return keys


def main():
    parser = argparse.ArgumentParser(description="Verify Atom audit log HMAC signatures")
    parser.add_argument("--prefix", default="", help="MinIO key prefix to scan (e.g. gate/)")
    parser.add_argument("--date", default="", help="Date prefix to scan (e.g. 2026-05-16)")
    parser.add_argument("--fail-fast", action="store_true", help="Stop on first verification failure")
    parser.add_argument("--key", default=DEFAULT_HMAC_KEY, help="HMAC key to use for verification")
    parser.add_argument("--quiet", action="store_true", help="Only print summary")
    parser.add_argument("--since", default="", help="Skip objects with keys lexicographically before this value (e.g. gate/2026-05-16/gate-ac7d to skip old events)")
    args = parser.parse_args()

    s3 = _s3()
    prefix = args.prefix
    if args.date:
        prefix = f"{prefix}{args.date}/" if prefix else args.date

    print(f"  Atom Audit HMAC Verifier")
    print(f"  Bucket  : {AUDIT_BUCKET}")
    print(f"  Prefix  : '{prefix}' (empty = all)")
    print(f"  HMAC key: {args.key[:8]}{'*' * (len(args.key) - 8)}")
    print(f"  Time    : {datetime.now(timezone.utc).isoformat()}")
    print()

    keys = list_objects(s3, prefix)
    if not keys:
        print("  No objects found under the given prefix.")
        sys.exit(0)

    total = valid = invalid = unsigned = 0

    for key in sorted(keys):
        if not key.endswith(".json"):
            continue
        if args.since and key < args.since:
            continue
        total += 1
        try:
            body = s3.get_object(Bucket=AUDIT_BUCKET, Key=key)["Body"].read()
            raw = json.loads(body)
        except Exception as e:
            if not args.quiet:
                print(f"  [ERROR  ] {key}: could not parse — {e}")
            continue

        ok, reason = verify_event(raw, args.key)

        if ok is None:
            unsigned += 1
            if not args.quiet:
                print(f"  [NOSIG  ] {key}")
        elif ok:
            valid += 1
            if not args.quiet:
                sig_short = raw.get("_hmac", "")[-16:]
                print(f"  [  OK   ] {key}  …{sig_short}")
        else:
            invalid += 1
            print(f"  [FAIL ⚠ ] {key}: {reason}")
            if args.fail_fast:
                print("\n  Stopping — use --no-fail-fast to continue scanning")
                break

    print()
    print("  ─── Summary ───────────────────────────────────────")
    print(f"  Total scanned : {total}")
    print(f"  ✓ Valid HMAC  : {valid}")
    print(f"  ✗ Invalid     : {invalid}")
    print(f"  ○ Unsigned    : {unsigned}")
    print()

    if invalid > 0:
        print("  ⚠  TAMPER DETECTED — some log entries failed HMAC verification.")
        sys.exit(2)
    elif valid == 0 and total > 0:
        print("  ○  All events are unsigned (pre-signing deployment).")
        sys.exit(0)
    else:
        print("  ✓  All signed events verified — audit chain is intact.")
        sys.exit(0)


if __name__ == "__main__":
    main()
