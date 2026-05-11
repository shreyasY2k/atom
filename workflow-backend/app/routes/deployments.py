"""Workflow deployment requests — mirrors agent deploy-request shape.

Records are stored in MinIO atom-deployments bucket (same as builder-backend uses).
Approve/reject endpoints live in builder-backend (it's the source of truth).
"""

import hashlib
import os
from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.core import deployments_store

router = APIRouter(tags=["deployments"])


class DeployRequestBody(BaseModel):
    notes: str = ""
    previous_request_id: str | None = None


SPECS_PATH = os.environ.get("SPECS_PATH", "/app/specs")


def _load_spec_yaml(name: str) -> tuple[str, dict]:
    from pathlib import Path
    p = Path(SPECS_PATH) / "workflows" / f"{name}.yaml"
    if not p.exists():
        raise HTTPException(404, f"Workflow spec not found: {p}")
    raw = p.read_text()
    return raw, yaml.safe_load(raw)


@router.post("/workflows/{name}/deploy-request")
def workflow_deploy_request(name: str, body: DeployRequestBody, request: Request):
    """Submit a workflow deployment request for approval."""
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    raw, spec_dict = _load_spec_yaml(name)
    version = (spec_dict.get("metadata") or {}).get("version", "0.1.0")
    spec_hash = "sha256:" + hashlib.sha256(
        yaml.dump(spec_dict, sort_keys=True).encode()
    ).hexdigest()

    record = deployments_store.create_record({
        "target_type": "workflow",
        "target_name": name,
        "target_version": version,
        "spec_hash": spec_hash,
        "requested_by": actor,
        "approval_status": "pending",
        "deploy_status": "pending",
        "notes": body.notes,
        "previous_request_id": body.previous_request_id,
    })
    deployments_store.emit_deployment_audit("deployment_requested", record, actor)
    return record


@router.post("/workflows/{name}/deploy-direct")
def workflow_deploy_direct(name: str, body: DeployRequestBody, request: Request):
    """Platform Admin bypass — register workflow immediately, no approval."""
    from app.core.registry_db import upsert as wf_upsert
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    raw, spec_dict = _load_spec_yaml(name)
    version = (spec_dict.get("metadata") or {}).get("version", "0.1.0")
    spec_hash = "sha256:" + hashlib.sha256(
        yaml.dump(spec_dict, sort_keys=True).encode()
    ).hexdigest()
    now = datetime.now(timezone.utc).isoformat()

    record = deployments_store.create_record({
        "target_type": "workflow",
        "target_name": name,
        "target_version": version,
        "spec_hash": spec_hash,
        "requested_by": actor,
        "approval_status": "bypassed",
        "approved_by": actor,
        "approved_at": now,
        "deploy_status": "deploying",
        "notes": body.notes,
    })
    deployments_store.emit_deployment_audit("deployment_bypassed", record, actor,
                                            notes="Admin bypass deploy")

    # Register immediately
    try:
        from app.routes.workflows import _do_register
        _do_register(name, raw, actor)
        deployments_store.update_record(
            record["deployment_id"],
            deploy_status="deployed",
            deployed_at=datetime.now(timezone.utc).isoformat(),
        )
        record = deployments_store.get_record(record["deployment_id"]) or record
        deployments_store.emit_deployment_audit("deployment_completed", record,
                                                "system:workflow-backend")
    except Exception as e:
        deployments_store.update_record(record["deployment_id"],
                                        deploy_status="failed", deploy_error=str(e))
        record = deployments_store.get_record(record["deployment_id"]) or record

    return record


@router.get("/workflows/{name}/deployments")
def list_workflow_deployments(name: str):
    """Deployment history for one workflow."""
    return {"deployments": deployments_store.list_records(
        target_type="workflow", target_name=name
    )}
