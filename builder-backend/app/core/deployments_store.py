"""Deployment record persistence (MinIO atom-deployments bucket) and deployment audit events."""

import json
import os
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError


_BUCKET = "atom-deployments"
_AUDIT_BUCKET = "audit-logs"


def _s3():
    return boto3.client(
        "s3",
        endpoint_url=f"http://{os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
        aws_access_key_id=os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        region_name="us-east-1",
    )


def _key(record: dict) -> str:
    return f"{record['target_type']}/{record['target_name']}/{record['deployment_id']}.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_record(fields: dict) -> dict:
    """Create a new deployment record and write it to MinIO. Returns the full record."""
    record = {
        "deployment_id": f"dep-{uuid.uuid4().hex[:8]}",
        "target_type": fields["target_type"],
        "target_name": fields["target_name"],
        "target_version": fields.get("target_version", ""),
        "spec_hash": fields.get("spec_hash", ""),
        "code_hash": fields.get("code_hash"),
        "requested_by": fields.get("requested_by", ""),
        "requested_at": _now(),
        "approval_status": fields.get("approval_status", "pending"),
        "approved_by": fields.get("approved_by"),
        "approved_at": fields.get("approved_at"),
        "deploy_status": fields.get("deploy_status", "pending"),
        "deployed_at": None,
        "deploy_error": None,
        "service_account_id": None,
        "notes": fields.get("notes", ""),
        "previous_request_id": fields.get("previous_request_id"),
    }
    _write(record)
    return record


def get_record(deployment_id: str) -> dict | None:
    """Scan all targets for this deployment_id. Returns None if not found."""
    s3 = _s3()
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=_BUCKET):
            for obj in page.get("Contents", []):
                if deployment_id in obj["Key"] and obj["Key"].endswith(".json"):
                    body = s3.get_object(Bucket=_BUCKET, Key=obj["Key"])["Body"].read()
                    rec = json.loads(body)
                    if rec.get("deployment_id") == deployment_id:
                        return rec
    except Exception:
        pass
    return None


def update_record(deployment_id: str, **updates) -> dict:
    """Read, apply updates, write back. Returns updated record."""
    record = get_record(deployment_id)
    if record is None:
        raise KeyError(f"deployment {deployment_id!r} not found")
    record.update(updates)
    _write(record)
    return record


def list_records(
    target_type: str | None = None,
    target_name: str | None = None,
    approval_status: str | None = None,
    deploy_status: str | None = None,
    requester: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """List deployment records with optional filters."""
    s3 = _s3()
    prefix = ""
    if target_type:
        prefix = f"{target_type}/"
        if target_name:
            prefix = f"{target_type}/{target_name}/"

    records: list[dict] = []
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=_BUCKET, Prefix=prefix):
            for obj in page.get("Contents", []):
                if not obj["Key"].endswith(".json"):
                    continue
                try:
                    body = s3.get_object(Bucket=_BUCKET, Key=obj["Key"])["Body"].read()
                    rec = json.loads(body)
                    if approval_status and rec.get("approval_status") != approval_status:
                        continue
                    if deploy_status and rec.get("deploy_status") != deploy_status:
                        continue
                    if requester and rec.get("requested_by") != requester:
                        continue
                    records.append(rec)
                except Exception:
                    continue
    except Exception:
        pass

    records.sort(key=lambda r: r.get("requested_at", ""), reverse=True)
    return records[:limit]


def emit_deployment_audit(event_type: str, record: dict, actor: str, notes: str = "") -> None:
    """Write a deployment audit event to audit-logs/deployment/ (object-locked bucket)."""
    try:
        now = datetime.now(timezone.utc)
        key = f"deployment/{now.strftime('%Y-%m-%d')}/{now.isoformat()}-{event_type}.json"
        event = {
            "event_type": event_type,
            "timestamp": now.isoformat(),
            "actor_type": "human" if actor.startswith("user:") else "system",
            "actor_id": actor,
            "deployment_id": record.get("deployment_id"),
            "target_type": record.get("target_type"),
            "target_name": record.get("target_name"),
            "target_version": record.get("target_version"),
            "notes": notes or record.get("notes", ""),
        }
        body = json.dumps(event).encode()
        _s3().put_object(Bucket=_AUDIT_BUCKET, Key=key, Body=body, ContentType="application/json")
    except Exception:
        pass


def _write(record: dict) -> None:
    try:
        key = _key(record)
        body = json.dumps(record).encode()
        _s3().put_object(Bucket=_BUCKET, Key=key, Body=body, ContentType="application/json")
    except Exception:
        pass
