"""Deployment request management — list, approve, reject, request-changes.

builder-backend is the source of truth for ALL deployment records (agents + workflows).
Approval of a workflow deployment POSTs to workflow-backend /register.
Approval of an agent deployment calls _bg_deploy_agent directly.
"""

import os
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from app.core import deployments_store
from app.routes.agents import _bg_deploy_agent

router = APIRouter(prefix="/deployments", tags=["deployments"])

WORKFLOW_BACKEND_URL = os.environ.get("WORKFLOW_BACKEND_URL", "http://workflow-backend:8082")


class ApproveBody(BaseModel):
    notes: str = ""


class RejectBody(BaseModel):
    reason: str


class ChangesBody(BaseModel):
    comments: str


# ---------------------------------------------------------------------------
# GET /deployments
# GET /deployments/{id}
# ---------------------------------------------------------------------------

@router.get("")
def list_deployments(
    approval_status: str | None = None,
    deploy_status: str | None = None,
    target_type: str | None = None,
    target_name: str | None = None,
    requester: str | None = None,
    limit: int = 100,
):
    records = deployments_store.list_records(
        target_type=target_type,
        target_name=target_name,
        approval_status=approval_status,
        deploy_status=deploy_status,
        requester=requester,
        limit=limit,
    )
    return {"deployments": records, "total": len(records)}


@router.get("/{deployment_id}")
def get_deployment(deployment_id: str):
    record = deployments_store.get_record(deployment_id)
    if record is None:
        raise HTTPException(404, f"Deployment {deployment_id!r} not found")
    return record


# ---------------------------------------------------------------------------
# POST /deployments/{id}/approve
# ---------------------------------------------------------------------------

@router.post("/{deployment_id}/approve")
def approve_deployment(
    deployment_id: str,
    body: ApproveBody,
    request: Request,
    background_tasks: BackgroundTasks,
):
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    record = _get_or_404(deployment_id)

    if record.get("approval_status") not in ("pending", "changes_requested"):
        raise HTTPException(409, f"Cannot approve: current status is {record.get('approval_status')!r}")

    now = datetime.now(timezone.utc).isoformat()
    record = deployments_store.update_record(
        deployment_id,
        approval_status="approved",
        approved_by=actor,
        approved_at=now,
        deploy_status="deploying",
        notes=body.notes or record.get("notes", ""),
    )
    deployments_store.emit_deployment_audit("deployment_approved", record, actor, notes=body.notes)
    deployments_store.emit_deployment_audit("deployment_started", record, "system:builder-backend")

    target_type = record.get("target_type")
    target_name = record.get("target_name", "")

    if target_type == "agent":
        background_tasks.add_task(_bg_deploy_agent, deployment_id, target_name, actor)
    elif target_type == "workflow":
        background_tasks.add_task(_bg_deploy_workflow, deployment_id, target_name, actor)
    else:
        raise HTTPException(400, f"Unknown target_type: {target_type!r}")

    return deployments_store.get_record(deployment_id)


# ---------------------------------------------------------------------------
# POST /deployments/{id}/reject
# ---------------------------------------------------------------------------

@router.post("/{deployment_id}/reject")
def reject_deployment(deployment_id: str, body: RejectBody, request: Request):
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    record = _get_or_404(deployment_id)

    if record.get("approval_status") not in ("pending", "changes_requested"):
        raise HTTPException(409, f"Cannot reject: current status is {record.get('approval_status')!r}")

    record = deployments_store.update_record(
        deployment_id,
        approval_status="rejected",
        approved_by=actor,
        approved_at=datetime.now(timezone.utc).isoformat(),
        notes=body.reason,
    )
    deployments_store.emit_deployment_audit("deployment_rejected", record, actor, notes=body.reason)
    return record


# ---------------------------------------------------------------------------
# POST /deployments/{id}/request-changes
# ---------------------------------------------------------------------------

@router.post("/{deployment_id}/request-changes")
def request_changes(deployment_id: str, body: ChangesBody, request: Request):
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    record = _get_or_404(deployment_id)

    if record.get("approval_status") not in ("pending",):
        raise HTTPException(409, f"Cannot request changes: current status is {record.get('approval_status')!r}")

    record = deployments_store.update_record(
        deployment_id,
        approval_status="changes_requested",
        approved_by=actor,
        notes=body.comments,
    )
    deployments_store.emit_deployment_audit("deployment_changes_requested", record, actor,
                                            notes=body.comments)
    return record


# ---------------------------------------------------------------------------
# Background deploy task for workflows
# ---------------------------------------------------------------------------

def _bg_deploy_workflow(deployment_id: str, name: str, actor: str) -> None:
    """Background task: register workflow via workflow-backend."""
    try:
        r = httpx.post(
            f"{WORKFLOW_BACKEND_URL}/workflows/{name}/register",
            headers={"X-Atom-Actor": actor},
            timeout=60,
        )
        r.raise_for_status()
        deployments_store.update_record(
            deployment_id,
            deploy_status="deployed",
            deployed_at=datetime.now(timezone.utc).isoformat(),
        )
        rec = deployments_store.get_record(deployment_id) or {}
        deployments_store.emit_deployment_audit("deployment_completed", rec, "system:builder-backend")
    except Exception as e:
        deployments_store.update_record(deployment_id, deploy_status="failed", deploy_error=str(e))
        rec = deployments_store.get_record(deployment_id) or {}
        deployments_store.emit_deployment_audit("deployment_failed", rec, "system:builder-backend",
                                                notes=str(e))


def _get_or_404(deployment_id: str) -> dict:
    record = deployments_store.get_record(deployment_id)
    if record is None:
        raise HTTPException(404, f"Deployment {deployment_id!r} not found")
    return record
