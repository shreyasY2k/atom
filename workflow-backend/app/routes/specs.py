"""Routes: workflow spec validation and generation."""

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from app.core.schema import WorkflowSpec
from app.core.validator import validate

router = APIRouter(prefix="/specs/workflow", tags=["specs"])


class ValidateRequest(BaseModel):
    yaml_text: str


class GenerateRequest(BaseModel):
    prose: str


@router.post("/validate")
def validate_spec(req: ValidateRequest):
    """Validate a workflow-spec YAML string."""
    try:
        spec_dict = yaml.safe_load(req.yaml_text)
    except yaml.YAMLError as e:
        raise HTTPException(400, f"Invalid YAML: {e}")

    try:
        spec = WorkflowSpec.model_validate(spec_dict)
    except ValidationError as e:
        raise HTTPException(422, {"errors": e.errors()})

    errors = validate(spec, check_agents=False)
    if errors:
        raise HTTPException(400, {"valid": False, "errors": errors})

    return {
        "valid": True,
        "name": spec.metadata.name,
        "domain": spec.metadata.domain,
        "node_count": len(spec.spec.nodes),
        "task_queue": spec.spec.deployment.task_queue,
    }


@router.post("/generate")
def generate_spec(req: GenerateRequest):
    """Mode C (optional): NL prose → workflow-spec YAML."""
    raise HTTPException(501, "Mode C (NL workflow generation) is off critical path. "
                             "Use the Composer UI or supply a spec YAML directly.")
