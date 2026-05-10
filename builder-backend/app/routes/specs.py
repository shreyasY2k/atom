"""Routes: spec validation and NL prose → spec generation."""

import os
from pathlib import Path
from typing import Any

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ValidationError

from app.core.codegen import generate_skill, generate_spec
from app.core.schema import AgentSpec

router = APIRouter(prefix="/specs/agent", tags=["specs"])


def _safe_errors(e: ValidationError) -> list[dict[str, Any]]:
    """Return Pydantic validation errors with all ctx values stringified.

    Pydantic's e.errors() can include non-JSON-serializable objects (e.g.
    ValueError instances) in the 'ctx' dict. FastAPI can't serialize those,
    causing a secondary TypeError. This converts everything to safe types.
    """
    safe = []
    for err in e.errors():
        cleaned = {k: v for k, v in err.items() if k != "ctx"}
        if "ctx" in err:
            cleaned["ctx"] = {ck: str(cv) for ck, cv in err["ctx"].items()}
        safe.append(cleaned)
    return safe

SPECS_PATH  = Path(os.environ.get("SPECS_PATH", "/app/specs"))
SKILLS_PATH = Path(os.environ.get("SKILLS_PATH", "/app/skills"))


class ValidateRequest(BaseModel):
    yaml_text: str


class GenerateRequest(BaseModel):
    prose: str


@router.post("/validate")
def validate_spec(req: ValidateRequest):
    """Validate an agent-spec YAML string against the AgentSpec schema."""
    try:
        spec_dict = yaml.safe_load(req.yaml_text)
    except yaml.YAMLError as e:
        raise HTTPException(400, f"Invalid YAML: {e}")

    try:
        spec = AgentSpec.model_validate(spec_dict)
    except ValidationError as e:
        raise HTTPException(422, {"errors": _safe_errors(e)})

    return {
        "valid": True,
        "name": spec.metadata.name,
        "domain": spec.metadata.domain,
        "version": spec.metadata.version,
        "agent_count": len(spec.spec.agents),
        "flow_type": spec.spec.flow.type,
    }


@router.post("/generate")
def generate(req: GenerateRequest):
    """Generate an agent-spec YAML from a natural-language description."""
    if not req.prose.strip():
        raise HTTPException(400, "prose cannot be empty")
    if len(req.prose) > 2000:
        raise HTTPException(400, "prose too long (max 2000 chars)")

    try:
        spec_dict = generate_spec(req.prose)
    except Exception as e:
        raise HTTPException(502, f"Gemini call failed: {e}")

    # Validate what came back
    try:
        spec = AgentSpec.model_validate(spec_dict)
    except ValidationError as e:
        raise HTTPException(422, {
            "message": "Generated spec failed schema validation",
            "spec_dict": spec_dict,
            "errors": _safe_errors(e),
        })

    spec_yaml = yaml.dump(spec_dict, sort_keys=False, allow_unicode=True)

    # Generate a proper skill file via Gemini (runs in parallel with spec save)
    skill_content = ""
    skill_path_str = ""
    try:
        skill_content = generate_skill(req.prose, spec_dict)
    except Exception:
        # Non-fatal — fall back to a minimal stub if Gemini fails
        skill_content = (
            f"# {spec.metadata.name}\n\n"
            f"{spec.metadata.description}\n\n"
            "## Instructions\n\nAnalyse the input and return a valid JSON response.\n"
        )

    # 1. Save role content to agent-roles/<domain>/<spec-name>.role.md
    skill_path_str = ""
    for ag in spec.spec.agents:
        role_rel = ag.agent_role_file or f"agent-roles/{spec.metadata.domain}/{spec.metadata.name}.role.md"
        for node in spec_dict.get("spec", {}).get("agents", []):
            if node.get("name") == ag.name:
                node["agent_role_file"] = role_rel
                node.pop("skill", None)  # drop legacy field
        # Write role file
        role_path = Path("/app") / role_rel
        role_path.parent.mkdir(parents=True, exist_ok=True)
        role_path.write_text(skill_content)
        skill_path_str = str(role_path)

    # 2. Save spec to disk (skill paths now guaranteed to be present)
    spec_file = SPECS_PATH / "agents" / f"{spec.metadata.name}.yaml"
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    spec_file.write_text(yaml.dump(spec_dict, sort_keys=False, allow_unicode=True))

    return {
        "spec": spec_dict,
        "spec_yaml": spec_yaml,
        "skill_content": skill_content,
        "skill_path": skill_path_str,
        "name": spec.metadata.name,
        "domain": spec.metadata.domain,
        "spec_saved": str(spec_file),
    }
