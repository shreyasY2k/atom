"""Write structured events to MinIO audit-logs, workflow-artifacts, and specs buckets."""

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
                    actor_type: str, actor_id: str,
                    node_input: dict | None = None) -> None:
    emit(
        f"workflow-run/{run_id}",
        {"run_id": run_id, "node_id": node_id, "type": "node_start",
         "node_type": node_type, "actor_type": actor_type, "actor_id": actor_id,
         "node_input": node_input or {}},
    )


def emit_node_complete(run_id: str, node_id: str, node_type: str,
                       actor_type: str, actor_id: str,
                       duration_ms: int, result: str,
                       output_hash: str = "",
                       node_output: dict | None = None) -> None:
    emit(
        f"workflow-run/{run_id}",
        {"run_id": run_id, "node_id": node_id, "type": "node_complete",
         "node_type": node_type, "actor_type": actor_type, "actor_id": actor_id,
         "output_hash": output_hash, "duration_ms": duration_ms, "result": result,
         "node_output": node_output or {}},
    )


def emit_run_event(run_id: str, event_type: str, workflow_name: str) -> None:
    emit(
        f"workflow-run/{run_id}",
        {"run_id": run_id, "type": event_type, "workflow_name": workflow_name,
         "actor_type": "system", "actor_id": "system:workflow-engine"},
    )


def _put(bucket: str, key: str, body: bytes, content_type: str = "application/json") -> None:
    """Write an object to any MinIO bucket. Fails silently."""
    try:
        _s3().put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type)
    except Exception:
        pass


def read_run_events(run_id: str) -> list[dict]:
    """Read all node events for a workflow run from MinIO audit-logs/workflow-run/{run_id}/."""
    try:
        s3 = _s3()
        paginator = s3.get_paginator("list_objects_v2")
        events: list[dict] = []
        for page in paginator.paginate(Bucket="audit-logs", Prefix=f"workflow-run/{run_id}/"):
            for obj in page.get("Contents", []):
                try:
                    body = s3.get_object(Bucket="audit-logs", Key=obj["Key"])["Body"].read()
                    events.append(json.loads(body))
                except Exception:
                    continue
        events.sort(key=lambda e: e.get("timestamp", ""))
        return events
    except Exception:
        return []


def write_workflow_spec(name: str, version: str, yaml_text: str) -> None:
    """Write workflow spec to minio://specs/workflows/<name>/<version>/<ts>.yaml."""
    now = datetime.now(timezone.utc)
    key = f"workflows/{name}/{version}/{now.strftime('%Y%m%dT%H%M%S')}.yaml"
    _put("specs", key, yaml_text.encode(), "text/yaml")


def write_run_result(
    workflow_name: str,
    run_id: str,
    status: str,
    final_context: dict,
    events: list,
    started_at: str,
    duration_ms: int,
) -> None:
    """Write run summary and event log to minio://workflow-artifacts/<name>/<run_id>/."""
    prefix = f"{workflow_name}/{run_id}"

    result = {
        "run_id": run_id,
        "workflow_name": workflow_name,
        "status": status,
        "started_at": started_at,
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "duration_ms": duration_ms,
        "node_count": len(events),
        "final_context_keys": list(final_context.keys()),
        "final_context": final_context,
    }
    _put("workflow-artifacts", f"{prefix}/result.json",
         json.dumps(result, default=str).encode())
    _put("workflow-artifacts", f"{prefix}/events.json",
         json.dumps(events, default=str).encode())
