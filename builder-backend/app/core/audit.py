"""Write and read structured events across MinIO audit-logs, agent-artifacts, and specs buckets."""

import hashlib
import hmac as _hmac
import json
import os
from datetime import datetime, timezone

import boto3

_HMAC_KEY = os.environ.get("AUDIT_HMAC_KEY", "atom-audit-hmac-key-change-in-prod")


def _sign(event: dict) -> dict:
    """Return a copy of event with an _hmac field appended."""
    payload = json.dumps(event, sort_keys=True, separators=(',', ':'))
    sig = _hmac.new(_HMAC_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return {**event, "_hmac": f"hmac-sha256:{sig}"}


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
        aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        region_name="us-east-1",
    )


def emit(prefix: str, event: dict) -> None:
    """
    Write a JSON audit event to minio://audit-logs/{prefix}/{date}/{ts}.json.
    Fails silently so audit never blocks the critical path.
    """
    try:
        now = datetime.now(timezone.utc)
        key = f"{prefix}/{now.strftime('%Y-%m-%d')}/{now.isoformat()}.json"
        signed = _sign({**event, "timestamp": now.isoformat()})
        body = json.dumps(signed).encode()
        _s3().put_object(Bucket="audit-logs", Key=key, Body=body, ContentType="application/json")
    except Exception:
        pass


def emit_deploy(name: str, service_account_id: str, version: str, action: str = "deploy_agent") -> None:
    emit(
        f"deploy/{name}",
        {
            "actor_type": "system",
            "actor_id": "system:builder-backend",
            "action": action,
            "target": name,
            "version": version,
            "identity_issued": service_account_id,
        },
    )


def emit_build(name: str, owner: str, action: str = "generate_agent") -> None:
    emit(
        f"build/{owner}",
        {
            "actor_type": "human",
            "actor_id": owner,
            "action": action,
            "target": name,
        },
    )


def _put(bucket: str, key: str, body: bytes, content_type: str = "application/json") -> None:
    """Write an object to any MinIO bucket. Fails silently."""
    try:
        _s3().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    except Exception:
        pass


def write_agent_artifact(
    name: str,
    version: str,
    agent_code: str,
    spec_yaml: str,
    metadata: dict,
) -> None:
    """Write compiled agent artifacts to minio://agent-artifacts/<name>/<version>/."""
    prefix = f"{name}/{version}"
    _put("agent-artifacts", f"{prefix}/agent.py", agent_code.encode(), "text/x-python")
    _put("agent-artifacts", f"{prefix}/spec.yaml", spec_yaml.encode(), "text/yaml")
    _put("agent-artifacts", f"{prefix}/metadata.json",
         json.dumps({**metadata, "written_at": datetime.now(timezone.utc).isoformat()}).encode())


def write_agent_spec(name: str, version: str, spec_yaml: str) -> None:
    """Write agent spec to minio://specs/agents/<name>/<version>/spec.yaml."""
    key = f"agents/{name}/{version}/spec.yaml"
    _put("specs", key, spec_yaml.encode(), "text/yaml")


def write_agent_tombstone(name: str, version: str, service_account_id: str) -> None:
    """Mark agent as undeployed in minio://agent-artifacts/<name>/<version>/metadata.json."""
    prefix = f"{name}/{version}"
    _put("agent-artifacts", f"{prefix}/metadata.json",
         json.dumps({
             "name": name, "version": version,
             "service_account_id": service_account_id,
             "status": "undeployed",
             "undeployed_at": datetime.now(timezone.utc).isoformat(),
         }).encode())


def read_agent_run_events(
    service_account_id: str,
    started_at: str,
    completed_at: str,
) -> list[dict]:
    """Read LiteLLM audit events from MinIO for a specific agent run time window.

    Scans the audit-logs/litellm/ prefix for objects whose timestamps fall
    between started_at and completed_at (ISO strings).  Filters by the agent's
    service_account_id which appears as user_api_key_alias in LiteLLM events.

    Returns up to 50 events sorted by timestamp ascending.
    """
    try:
        s3 = _s3()
        start_dt = datetime.fromisoformat(started_at)
        end_dt = datetime.fromisoformat(completed_at)

        # Build a list of date prefixes to scan (handles runs crossing midnight)
        dates = set()
        cursor = start_dt.date()
        while cursor <= end_dt.date():
            dates.add(cursor.isoformat())
            from datetime import timedelta
            cursor += timedelta(days=1)

        # Convert ISO timestamps to Unix floats for comparison
        def _iso_to_float(s: str) -> float:
            try:
                return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
            except Exception:
                return 0.0

        t_start = _iso_to_float(started_at) - 2  # 2s buffer before
        t_end   = _iso_to_float(completed_at) + 30 if completed_at else _iso_to_float(started_at) + 600

        events: list[dict] = []
        for date in sorted(dates):
            # LiteLLM uses date-based prefixes directly (no litellm/ sub-prefix)
            for prefix in [f"{date}/", f"litellm/{date}/"]:
                try:
                    paginator = s3.get_paginator("list_objects_v2")
                    for page in paginator.paginate(Bucket="audit-logs", Prefix=prefix):
                        for obj in page.get("Contents", []):
                            try:
                                body = s3.get_object(Bucket="audit-logs", Key=obj["Key"])["Body"].read()
                                event = json.loads(body)

                                # Filter by service account (end_user, alias, or metadata.actor_id)
                                end_user = event.get("end_user") or ""
                                alias    = event.get("user_api_key_alias") or ""
                                meta     = event.get("metadata") or {}
                                actor    = meta.get("actor_id", "") if isinstance(meta, dict) else ""
                                if not (
                                    service_account_id in end_user
                                    or service_account_id in alias
                                    or service_account_id in actor
                                ):
                                    continue

                                # Time filter using Unix float comparison
                                t0 = event.get("startTime")
                                if t0:
                                    try:
                                        if not (t_start <= float(t0) <= t_end):
                                            continue
                                    except Exception:
                                        pass

                                events.append(event)
                            except Exception:
                                continue
                except Exception:
                    continue

        events.sort(key=lambda e: float(e.get("startTime") or 0))
        return events[:100]

    except Exception:
        return []
