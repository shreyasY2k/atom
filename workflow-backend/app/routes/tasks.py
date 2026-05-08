"""Proxy routes to the task-queue mock service."""

import os
import httpx
from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/tasks", tags=["tasks"])

_TQ = os.environ.get("TASK_QUEUE_URL", "http://task-queue:8098")


def _get(path: str, **params) -> dict:
    try:
        r = httpx.get(f"{_TQ}{path}", params=params, timeout=5)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
    except Exception as e:
        raise HTTPException(502, f"Task queue unreachable: {e}")


def _post(path: str, body: dict) -> dict:
    try:
        r = httpx.post(f"{_TQ}{path}", json=body, timeout=5)
        r.raise_for_status()
        return r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, e.response.text)
    except Exception as e:
        raise HTTPException(502, f"Task queue unreachable: {e}")


@router.get("")
def list_tasks(status: str = "OPEN", group: str = None):
    params = {"status": status}
    if group:
        params["group"] = group
    return _get("/tasks", **params)


@router.get("/{task_id}")
def get_task(task_id: str):
    return _get(f"/tasks/{task_id}")


@router.post("/{task_id}/resolve")
def resolve_task(task_id: str, payload: dict):
    return _post(f"/tasks/{task_id}/resolve", payload)
