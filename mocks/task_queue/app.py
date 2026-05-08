"""Human task queue mock. In V1 this is in-memory; in Phase 2, replace
with the bank's actual task management system (ServiceNow, Pega, etc.)."""
from fastapi import FastAPI, HTTPException
from typing import Literal
from datetime import datetime
import uuid

app = FastAPI(title="Human Task Queue", version="0.1.0")

# In-memory task store. Reset on restart — fine for demo.
TASKS: dict = {}

@app.get("/health")
def health(): return {"status": "ok", "open_tasks": sum(1 for t in TASKS.values() if t["status"] == "OPEN")}

@app.post("/tasks")
def create_task(payload: dict):
    task_id = f"TASK-{uuid.uuid4().hex[:10].upper()}"
    TASKS[task_id] = {
        "task_id": task_id,
        "workflow_run_id": payload.get("workflow_run_id"),
        "node_id": payload.get("node_id"),
        "assignee_group": payload.get("assignee_group"),
        "title": payload.get("title"),
        "description": payload.get("description"),
        "actions": payload.get("actions", ["accept", "reject", "edit"]),
        "context": payload.get("context", {}),
        "status": "OPEN",
        "created_at": datetime.utcnow().isoformat(),
        "resolved_at": None,
        "resolved_by": None,
        "resolution": None,
        "edits": None,
    }
    return TASKS[task_id]

@app.get("/tasks")
def list_tasks(status: str = "OPEN", group: str = None):
    out = [t for t in TASKS.values() if t["status"] == status]
    if group: out = [t for t in out if t["assignee_group"] == group]
    return {"count": len(out), "tasks": out}

@app.get("/tasks/{task_id}")
def get_task(task_id: str):
    t = TASKS.get(task_id)
    if not t: raise HTTPException(404, f"task {task_id} not found")
    return t

@app.post("/tasks/{task_id}/resolve")
def resolve(task_id: str, payload: dict):
    t = TASKS.get(task_id)
    if not t: raise HTTPException(404)
    t["status"] = "RESOLVED"
    t["resolved_at"] = datetime.utcnow().isoformat()
    t["resolved_by"] = payload.get("resolved_by", "user:demo@mphasis.com")
    t["resolution"] = payload.get("resolution")  # accept | reject | edit
    t["edits"] = payload.get("edits")
    return t
