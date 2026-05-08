"""Routes: start run, get status, SSE events, cancel."""

import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.core import audit, registry_db
from app.core.event_bus import subscribe
from app.core.schema import WorkflowSpec
from app.core.temporal_client import (
    cancel_workflow,
    describe_workflow,
    start_workflow,
)
from app.worker.runner import MphasisWorkflowRunner

router = APIRouter(tags=["runs"])

SPECS_PATH       = Path(os.environ.get("SPECS_PATH", "/app/specs"))
BUILDER_URL      = os.environ.get("BUILDER_BACKEND_URL", "http://builder-backend:8080")
TASK_QUEUE_URL   = os.environ.get("TASK_QUEUE_URL", "http://task-queue:8098")

# run_id → basic status dict (in-memory supplement to Temporal)
_run_index: dict[str, dict] = {}


def _load_workflow_spec(name: str) -> tuple[WorkflowSpec, dict]:
    p = SPECS_PATH / "workflows" / f"{name}.yaml"
    if not p.exists():
        raise HTTPException(404, f"spec not found at {p}")
    raw = p.read_text()
    try:
        spec_dict = yaml.safe_load(raw)
        spec = WorkflowSpec.model_validate(spec_dict)
    except (yaml.YAMLError, ValidationError) as e:
        raise HTTPException(422, f"Spec parse/validation error: {e}")
    return spec, spec_dict


def _resolve_agent_endpoints(spec: WorkflowSpec) -> tuple[dict, dict]:
    """Query builder-backend for endpoints of every agent node.
    Returns (agent_endpoints, agent_actor_ids).
    Raises HTTPException if any agent is not deployed."""
    endpoints: dict[str, str] = {}
    actor_ids: dict[str, str] = {}
    missing = []

    for node in spec.spec.nodes:
        if node.type != "agent":
            continue
        agent_name = node.agent_ref.name
        if agent_name in endpoints:
            continue
        try:
            r = httpx.get(f"{BUILDER_URL}/agents/{agent_name}", timeout=5)
            if not r.is_success or r.json().get("status") != "deployed":
                missing.append(agent_name)
                continue
            rec = r.json()
            endpoints[agent_name] = rec["endpoint"]
            actor_ids[agent_name] = rec["service_account_id"]
        except Exception as e:
            missing.append(f"{agent_name} (unreachable: {e})")

    if missing:
        raise HTTPException(409, {
            "detail": "Cannot start run: agents not deployed",
            "missing_agents": missing,
        })
    return endpoints, actor_ids


@router.post("/workflows/{name}/runs")
async def start_run(name: str, payload: dict):
    """Start a new workflow run. Returns run_id immediately."""
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"workflow '{name}' not registered")

    spec, spec_dict = _load_workflow_spec(name)

    # Resolve agent endpoints (fails hard if any agent not deployed)
    agent_endpoints, agent_actor_ids = _resolve_agent_endpoints(spec)

    run_id = f"run-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    # Record run in local index
    _run_index[run_id] = {
        "run_id": run_id,
        "workflow_name": name,
        "status": "running",
        "started_at": now,
        "input": payload,
    }

    # Emit run-start audit event
    audit.emit_run_event(run_id, "run_started", name)

    # Background task: collect events and write artifacts when run completes
    asyncio.create_task(_persist_run_artifacts(run_id, name, now))

    # Start Temporal workflow
    await start_workflow(
        workflow_id=run_id,
        workflow_cls=MphasisWorkflowRunner,
        args={
            "spec": spec_dict,
            "input": payload,
            "agent_endpoints": agent_endpoints,
            "agent_actor_ids": agent_actor_ids,
            "task_queue_url": TASK_QUEUE_URL,
            "run_id": run_id,
        },
        task_queue=spec.spec.deployment.task_queue,
    )

    return {"run_id": run_id, "workflow_name": name, "status": "started", "started_at": now}


@router.get("/workflows/{name}/runs/{run_id}")
async def get_run(name: str, run_id: str):
    """Get run status from Temporal."""
    try:
        desc = await describe_workflow(run_id)
    except Exception as e:
        # Fall back to local index
        if run_id in _run_index:
            return _run_index[run_id]
        raise HTTPException(404, f"run '{run_id}' not found: {e}")
    return {**_run_index.get(run_id, {}), **desc}


@router.get("/workflows/{name}/runs/{run_id}/nodes")
def get_run_nodes(name: str, run_id: str):
    """Get node-level execution events for a completed workflow run (from MinIO)."""
    events = audit.read_run_events(run_id)
    # Group into node steps
    nodes_started: dict[str, dict] = {}
    nodes_completed: dict[str, dict] = {}
    run_meta: dict = {}

    for ev in events:
        etype = ev.get("type", "")
        nid = ev.get("node_id")
        if etype == "run_started":
            run_meta = ev
        elif etype == "node_start" and nid:
            nodes_started[nid] = ev
        elif etype == "node_complete" and nid:
            nodes_completed[nid] = ev

    # Build ordered step list
    seen: set = set()
    steps = []
    for ev in events:
        nid = ev.get("node_id")
        if nid and nid not in seen and ev.get("type") == "node_start":
            seen.add(nid)
            start = nodes_started.get(nid, {})
            end = nodes_completed.get(nid, {})
            steps.append({
                "node_id": nid,
                "node_type": start.get("node_type", "unknown"),
                "actor_type": start.get("actor_type", "system"),
                "actor_id": start.get("actor_id", ""),
                "started_at": start.get("timestamp"),
                "completed_at": end.get("timestamp"),
                "duration_ms": end.get("duration_ms"),
                "result": end.get("result", "pending"),
                "output_hash": end.get("output_hash"),
                "status": "completed" if end else "running",
                "node_input": start.get("node_input", {}),
                "node_output": end.get("node_output", {}),
            })

    return {
        "run_id": run_id,
        "workflow_name": name,
        "run_started_at": run_meta.get("timestamp"),
        "steps": steps,
        "raw_event_count": len(events),
    }


@router.get("/workflows/{name}/runs/{run_id}/events")
async def stream_events(name: str, run_id: str):
    """SSE stream of node_started / node_completed / node_routed events."""
    async def _generator():
        async for event in subscribe(run_id):
            if event.get("event") == "keepalive":
                yield ": keepalive\n\n"
            else:
                yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(_generator(), media_type="text/event-stream")


async def _persist_run_artifacts(run_id: str, workflow_name: str, started_at: str) -> None:
    """Subscribe to SSE events for this run; write result to workflow-artifacts on completion."""
    t0 = time.time()
    collected_events: list[dict] = []
    try:
        async for event in subscribe(run_id):
            collected_events.append(event)
            etype = event.get("event", "")
            if etype in ("workflow_completed", "workflow_failed"):
                duration_ms = int((time.time() - t0) * 1000)
                run_rec = _run_index.get(run_id, {})
                final_ctx = run_rec.get("input", {})  # best we have without Temporal result
                status = "completed" if etype == "workflow_completed" else "failed"
                _run_index[run_id]["status"] = status
                audit.write_run_result(
                    workflow_name=workflow_name,
                    run_id=run_id,
                    status=status,
                    final_context=final_ctx,
                    events=collected_events,
                    started_at=started_at,
                    duration_ms=duration_ms,
                )
                break
    except Exception:
        pass


@router.get("/workflows/{name}/runs")
def list_runs(name: str, limit: int = 20):
    """List recent runs for a workflow."""
    runs = [v for v in _run_index.values() if v.get("workflow_name") == name]
    runs.sort(key=lambda r: r.get("started_at", ""), reverse=True)
    return {"runs": runs[:limit]}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str):
    """Cancel a running workflow execution."""
    try:
        await cancel_workflow(run_id)
    except Exception as e:
        raise HTTPException(400, f"Cancel failed: {e}")
    if run_id in _run_index:
        _run_index[run_id]["status"] = "cancelled"
    audit.emit_run_event(run_id, "run_cancelled", _run_index.get(run_id, {}).get("workflow_name", "unknown"))
    return {"run_id": run_id, "status": "cancelled"}
