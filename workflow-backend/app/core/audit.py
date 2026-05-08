"""Write structured audit events to MinIO audit-logs bucket."""

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
    """Write a JSON audit event. Fails silently."""
    try:
        now = datetime.now(timezone.utc)
        key = f"{prefix}/{now.strftime('%Y-%m-%d')}/{now.isoformat()}.json"
        body = json.dumps({**event, "timestamp": now.isoformat()}).encode()
        _s3().put_object(Bucket="audit-logs", Key=key, Body=body, ContentType="application/json")
    except Exception:
        pass


def emit_node_start(run_id: str, node_id: str, node_type: str,
                    actor_type: str, actor_id: str) -> None:
    emit(
        f"workflow-run/{run_id}",
        {"run_id": run_id, "node_id": node_id, "type": "node_start",
         "node_type": node_type, "actor_type": actor_type, "actor_id": actor_id},
    )


def emit_node_complete(run_id: str, node_id: str, node_type: str,
                       actor_type: str, actor_id: str,
                       duration_ms: int, result: str,
                       output_hash: str = "") -> None:
    emit(
        f"workflow-run/{run_id}",
        {"run_id": run_id, "node_id": node_id, "type": "node_complete",
         "node_type": node_type, "actor_type": actor_type, "actor_id": actor_id,
         "output_hash": output_hash, "duration_ms": duration_ms, "result": result},
    )


def emit_run_event(run_id: str, event_type: str, workflow_name: str) -> None:
    emit(
        f"workflow-run/{run_id}",
        {"run_id": run_id, "type": event_type, "workflow_name": workflow_name,
         "actor_type": "system", "actor_id": "system:workflow-engine"},
    )
