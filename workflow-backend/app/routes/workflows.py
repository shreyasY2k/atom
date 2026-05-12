"""Routes: workflow registration, list, get."""

import hashlib
import os
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from app.core import audit, registry_db
from app.core.schema import WorkflowSpec
from app.core.validator import validate

router = APIRouter(prefix="/workflows", tags=["workflows"])

SPECS_PATH = Path(os.environ.get("SPECS_PATH", "/app/specs"))


class RegisterRequest(BaseModel):
    yaml_text: str | None = None  # if None, load from specs/workflows/{name}.yaml


class SaveSpecRequest(BaseModel):
    yaml_text: str


def _load_spec(name: str, yaml_text: str | None) -> tuple[WorkflowSpec, dict]:
    if yaml_text:
        raw = yaml_text
    else:
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


def _do_register(name: str, yaml_text: str | None = None, actor: str = "system") -> dict:
    """Core register logic — callable without an HTTP request."""
    spec, spec_dict = _load_spec(name, yaml_text)

    errors = validate(spec, check_agents=False)
    if errors:
        raise HTTPException(400, {"valid": False, "errors": errors})

    agent_errors = validate(spec, check_agents=True)
    agent_warnings = [e for e in agent_errors if "not found" in e["reason"]
                      or "not deployed" in e["reason"]]

    spec_hash = hashlib.sha256(yaml.dump(spec_dict, sort_keys=True).encode()).hexdigest()[:16]
    now = datetime.now(timezone.utc).isoformat()

    registry_db.upsert({
        "name": name,
        "version": spec.metadata.version,
        "domain": spec.metadata.domain,
        "task_queue": spec.spec.deployment.task_queue,
        "registered_at": now,
        "spec_hash": spec_hash,
        "status": "registered",
    })

    return {
        "registered": True,
        "name": name,
        "version": spec.metadata.version,
        "task_queue": spec.spec.deployment.task_queue,
        "spec_hash": spec_hash,
        "warnings": agent_warnings or [],
    }


@router.post("/{name}/register")
def register_workflow(name: str, req: RegisterRequest = RegisterRequest()):
    return _do_register(name, req.yaml_text)


@router.get("")
def list_workflows():
    return {"workflows": registry_db.list_all()}


@router.get("/specs")
def list_workflow_specs():
    """List workflow YAML files present on disk (registered or not).
    Used by the UI to show available specs before registration."""
    specs_dir = SPECS_PATH / "workflows"
    registered = {r["name"] for r in registry_db.list_all()}
    results = []
    if specs_dir.exists():
        for p in sorted(specs_dir.glob("*.yaml")):
            name = p.stem
            try:
                raw = yaml.safe_load(p.read_text())
                meta = raw.get("metadata", {}) if isinstance(raw, dict) else {}
            except Exception:
                meta = {}
            results.append({
                "name": name,
                "version": meta.get("version", "unknown"),
                "domain": meta.get("domain", ""),
                "description": meta.get("description", ""),
                "registered": name in registered,
            })
    return {"specs": results}


@router.get("/{name}/spec")
def get_workflow_spec(name: str):
    """Return the raw YAML spec for a workflow (used by Composer canvas)."""
    p = SPECS_PATH / "workflows" / f"{name}.yaml"
    if not p.exists():
        raise HTTPException(404, f"spec not found at {p}")
    return {"name": name, "yaml": p.read_text()}


@router.put("/{name}/spec")
def save_workflow_spec(name: str, req: SaveSpecRequest):
    """Write a workflow spec YAML to disk. Does not validate or register."""
    try:
        parsed = yaml.safe_load(req.yaml_text)
        if not isinstance(parsed, dict):
            raise HTTPException(400, "YAML must be a mapping")
    except yaml.YAMLError as e:
        raise HTTPException(400, f"Invalid YAML: {e}")
    p = SPECS_PATH / "workflows" / f"{name}.yaml"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(req.yaml_text)
    # Mirror to MinIO specs bucket (non-blocking)
    version = parsed.get("metadata", {}).get("version", "unknown")
    audit.write_workflow_spec(name=name, version=version, yaml_text=req.yaml_text)
    return {"saved": True, "name": name, "bytes": len(req.yaml_text)}


@router.get("/{name}")
def get_workflow(name: str):
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"workflow '{name}' not registered")
    return rec
