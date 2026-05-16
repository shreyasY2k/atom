"""
Audit events API — reads MinIO and returns normalized + raw events.
Two sources:
  - audit-logs/{date}/*.json          LiteLLM LLM/tool call events
  - audit-logs/workflow-run/{run_id}/{date}/*.json   our node events
"""

import json
import os
from datetime import datetime, timezone
from typing import Optional

import boto3
from botocore.exceptions import ClientError
from fastapi import APIRouter

router = APIRouter(prefix="/audit", tags=["audit"])

_MINIO = os.environ.get("MINIO_ENDPOINT", "minio:9000")
_AK    = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
_SK    = os.environ.get("MINIO_SECRET_KEY", "minioadmin")


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{_MINIO}",
        aws_access_key_id=_AK,
        aws_secret_access_key=_SK,
        region_name="us-east-1",
    )


def _read_object(s3, key: str) -> Optional[dict]:
    try:
        body = s3.get_object(Bucket="audit-logs", Key=key)["Body"].read()
        return json.loads(body)
    except Exception:
        return None


def _list_keys(s3, prefix: str, max_keys: int = 60) -> list[str]:
    try:
        resp = s3.list_objects_v2(Bucket="audit-logs", Prefix=prefix, MaxKeys=max_keys)
        contents = resp.get("Contents", [])
        # Sort newest first by LastModified
        contents.sort(key=lambda o: o["LastModified"], reverse=True)
        return [o["Key"] for o in contents]
    except ClientError:
        return []


def _normalize_llm(raw: dict, key: str) -> dict:
    """Normalize a LiteLLM audit event to the common format."""
    meta = raw.get("metadata", {})
    usage = raw.get("usage", {})
    ts_raw = raw.get("startTime") or raw.get("endTime")
    ts = (
        datetime.fromtimestamp(ts_raw, tz=timezone.utc).isoformat()
        if isinstance(ts_raw, (int, float))
        else str(ts_raw or "")
    )
    actor_id = meta.get("user_api_key_alias") or raw.get("user_id", "system:litellm")
    return {
        "id": key,
        "timestamp": ts,
        "source": "llm",
        "event_type": raw.get("call_type", "llm_call"),
        "actor_type": "agent" if actor_id and actor_id.startswith("svc-acct-") else "system",
        "actor_id": actor_id or "system:litellm",
        "model": raw.get("model", ""),
        "input_tokens": usage.get("prompt_tokens", 0),
        "output_tokens": usage.get("completion_tokens", 0),
        "duration_ms": int((raw.get("response_time") or 0) * 1000),
        "run_id": meta.get("run_id"),
        "node_id": meta.get("node_id"),
        "hmac": raw.get("_hmac"),
        "raw": raw,
    }


def _normalize_workflow(raw: dict, key: str) -> dict:
    """Normalize one of our workflow-run audit events."""
    return {
        "id": key,
        "timestamp": raw.get("timestamp", ""),
        "source": "workflow",
        "event_type": raw.get("type", raw.get("action", "unknown")),
        "actor_type": raw.get("actor_type", "system"),
        "actor_id": raw.get("actor_id", "system:workflow-engine"),
        "model": None,
        "input_tokens": None,
        "output_tokens": None,
        "duration_ms": raw.get("duration_ms"),
        "run_id": raw.get("run_id"),
        "node_id": raw.get("node_id"),
        "hmac": raw.get("_hmac"),
        "raw": raw,
    }


@router.get("/events")
def list_events(
    date: Optional[str] = None,
    run_id: Optional[str] = None,
    actor_type: Optional[str] = None,
    limit: int = 150,
):
    """
    Return recent audit events from MinIO, newest first.
    Combines LiteLLM LLM-call events and our workflow-run node events.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    query_date = date or today
    s3 = _s3()
    events = []

    # --- LLM events from LiteLLM S3 callback ---
    llm_keys = _list_keys(s3, f"{query_date}/", max_keys=80)
    for key in llm_keys:
        raw = _read_object(s3, key)
        if raw:
            events.append(_normalize_llm(raw, key))

    # --- Workflow-run node events ---
    if run_id:
        # Specific run
        wf_keys = _list_keys(s3, f"workflow-run/{run_id}/{query_date}/", max_keys=60)
        for key in wf_keys:
            raw = _read_object(s3, key)
            if raw:
                events.append(_normalize_workflow(raw, key))
    else:
        # All recent runs — list run_id prefixes first
        try:
            resp = s3.list_objects_v2(
                Bucket="audit-logs", Prefix="workflow-run/", Delimiter="/"
            )
            run_prefixes = [p["Prefix"] for p in resp.get("CommonPrefixes", [])]
        except Exception:
            run_prefixes = []

        for prefix in run_prefixes[-10:]:  # last 10 runs
            wf_keys = _list_keys(s3, f"{prefix}{query_date}/", max_keys=20)
            for key in wf_keys:
                raw = _read_object(s3, key)
                if raw:
                    events.append(_normalize_workflow(raw, key))

    # --- Deploy / build events ---
    for pfx in ["deploy/", "build/"]:
        d_keys = _list_keys(s3, pfx, max_keys=20)
        for key in d_keys:
            raw = _read_object(s3, key)
            if raw:
                events.append(_normalize_workflow(raw, key))

    # Filter by actor_type if requested
    if actor_type:
        events = [e for e in events if e["actor_type"] == actor_type]

    # Filter by run_id if requested
    if run_id:
        events = [e for e in events if e.get("run_id") == run_id or e["source"] == "llm"]

    # Sort newest first, dedupe by id
    seen = set()
    unique = []
    for e in events:
        if e["id"] not in seen:
            seen.add(e["id"])
            unique.append(e)

    unique.sort(key=lambda e: e["timestamp"], reverse=True)

    return {"events": unique[:limit], "total": len(unique)}
