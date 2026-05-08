"""Write and read structured audit events in MinIO audit-logs bucket."""

import json
import os
from datetime import datetime, timezone

import boto3


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
        body = json.dumps({**event, "timestamp": now.isoformat()}).encode()
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

        events: list[dict] = []
        for date in sorted(dates):
            for prefix in [f"litellm/{date}/", f"{date}/"]:
                try:
                    paginator = s3.get_paginator("list_objects_v2")
                    for page in paginator.paginate(Bucket="audit-logs", Prefix=prefix):
                        for obj in page.get("Contents", []):
                            try:
                                body = s3.get_object(Bucket="audit-logs", Key=obj["Key"])["Body"].read()
                                event = json.loads(body)
                                # Filter: only this agent's calls (by virtual key alias)
                                alias = (
                                    event.get("user_api_key_alias")
                                    or event.get("metadata", {}).get("actor_id")
                                    or event.get("actor_id", "")
                                )
                                if service_account_id not in str(alias):
                                    continue
                                # Time filter
                                ts = event.get("startTime") or event.get("timestamp", "")
                                if ts and not (started_at <= ts[:26] <= completed_at[:26]):
                                    continue
                                events.append(event)
                            except Exception:
                                continue
                except Exception:
                    continue

        events.sort(key=lambda e: e.get("startTime") or e.get("timestamp", ""))
        return events[:50]

    except Exception:
        return []
