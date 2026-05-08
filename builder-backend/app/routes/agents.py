"""Routes: compile, deploy, invoke, run events."""

import hashlib
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, HTTPException

from app.core import audit, codegen, identity, registry_db
from app.core.container import LocalDeployManager, WORK_DIR, AGENT_PORT, container_healthy
from app.core.schema import AgentSpec
from pydantic import ValidationError

# In-memory index of agent test runs (transient — resets on restart)
_agent_runs: dict[str, dict] = {}

router = APIRouter(prefix="/agents", tags=["agents"])

SPECS_PATH  = Path(os.environ.get("SPECS_PATH", "/app/specs"))
LITELLM_BASE_URL = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000")
REME_URL         = os.environ.get("REME_URL", "http://reme:8002")

# Mock service URLs to inject into agent containers
_AGENT_ENV_BASE = {k: v for k, v in os.environ.items() if k.endswith("_URL") or k.endswith("_SVC_URL")}


def _load_spec(name: str) -> tuple[AgentSpec, dict]:
    spec_path = SPECS_PATH / "agents" / f"{name}.yaml"
    if not spec_path.exists():
        raise HTTPException(404, f"spec not found at {spec_path}")
    raw = spec_path.read_text()
    try:
        spec_dict = yaml.safe_load(raw)
        spec = AgentSpec.model_validate(spec_dict)
    except (yaml.YAMLError, ValidationError) as e:
        raise HTTPException(422, f"Spec parse/validation error: {e}")
    return spec, spec_dict


# ---------------------------------------------------------------------------
# POST /agents/{name}/compile
# ---------------------------------------------------------------------------

@router.post("/{name}/compile")
def compile_agent(name: str):
    """Generate and validate agent.py from the spec."""
    spec, spec_dict = _load_spec(name)

    try:
        code = codegen.compile_agent(name, spec, spec_dict)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(502, f"Code generation failed: {e}")

    chash = codegen.code_hash(code)
    audit.emit_build(name=name, owner=spec.metadata.owner)

    return {
        "name": name,
        "version": spec.metadata.version,
        "code_hash": chash,
        "code_length": len(code),
        "code": code,
    }


# ---------------------------------------------------------------------------
# POST /agents/{name}/deploy
# ---------------------------------------------------------------------------

@router.post("/{name}/deploy")
def deploy_agent(name: str):
    """Compile (if needed), issue identity, build+run container, register."""
    spec, spec_dict = _load_spec(name)

    # 1. Generate code
    try:
        code = codegen.compile_agent(name, spec, spec_dict)
    except (ValueError, Exception) as e:
        raise HTTPException(502, f"Code generation failed: {e}")

    chash = codegen.code_hash(code)
    spec_hash = hashlib.sha256(
        yaml.dump(spec_dict, sort_keys=True).encode()
    ).hexdigest()[:16]

    # 2. Revoke any existing key for this agent before issuing a new one
    existing = registry_db.get(name)
    if existing and existing.get("virtual_key"):
        try:
            identity.revoke_identity(existing["virtual_key"])
        except Exception:
            pass  # old key may already be gone; proceed

    # Issue service-account identity
    try:
        svc_id, vkey = identity.issue_identity(name, spec_dict, spec)
    except Exception as e:
        raise HTTPException(502, f"Identity issuance failed: {e}")

    # 3a. Pre-save key so we can revoke it if container build fails
    registry_db.upsert({
        "name": name, "version": spec.metadata.version,
        "service_account_id": svc_id, "virtual_key": vkey,
        "owner": spec.metadata.owner, "deployed_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": None, "container_id": None,
        "spec_hash": spec_hash, "code_hash": chash, "status": "deploying",
    })

    # 3b. Build + run container via LocalDeployManager
    from app.core.container import STUDIO_URL
    env = {
        **_AGENT_ENV_BASE,
        "LITELLM_BASE_URL": LITELLM_BASE_URL,
        "LITELLM_API_KEY": vkey,
        "SERVICE_ACCOUNT_ID": svc_id,
        "REME_URL": REME_URL,
        "STUDIO_URL": STUDIO_URL,
    }
    deploy_mgr = LocalDeployManager(
        workdir=str(WORK_DIR / "agents" / f"{name}-{spec.metadata.version}")
    )
    try:
        deploy_result = deploy_mgr.deploy(
            name=name,
            version=spec.metadata.version,
            agent_code=code,
            port=AGENT_PORT,
            env=env,
        )
        endpoint = deploy_result["endpoint"]
    except Exception as e:
        # Revoke key to avoid orphaned keys
        try:
            identity.revoke_identity(vkey)
        except Exception:
            pass
        raise HTTPException(502, f"Container build/run failed: {e}")

    # 4. Wait for health
    healthy = False
    import time
    for _ in range(30):
        if container_healthy(endpoint):
            healthy = True
            break
        time.sleep(1)

    if not healthy:
        raise HTTPException(502, "Agent container started but /health never returned 200")

    # 5. Register
    now = datetime.now(timezone.utc).isoformat()
    record = {
        "name": name,
        "version": spec.metadata.version,
        "service_account_id": svc_id,
        "virtual_key": vkey,
        "owner": spec.metadata.owner,
        "deployed_at": now,
        "endpoint": endpoint,
        "container_id": None,
        "spec_hash": spec_hash,
        "code_hash": chash,
        "status": "deployed",
    }
    registry_db.upsert(record)

    # 6. Audit events
    audit.emit_deploy(name=name, service_account_id=svc_id, version=spec.metadata.version)
    audit.emit_build(name=name, owner=spec.metadata.owner)

    # 7. Persist artifacts and spec to MinIO
    spec_yaml_text = yaml.dump(spec_dict, sort_keys=False, allow_unicode=True)
    audit.write_agent_artifact(
        name=name,
        version=spec.metadata.version,
        agent_code=code,
        spec_yaml=spec_yaml_text,
        metadata={k: v for k, v in record.items() if k != "virtual_key"},
    )
    audit.write_agent_spec(name=name, version=spec.metadata.version, spec_yaml=spec_yaml_text)

    return {k: v for k, v in record.items() if k != "virtual_key"}


# ---------------------------------------------------------------------------
# POST /agents/{name}/invoke
# ---------------------------------------------------------------------------

@router.post("/{name}/invoke")
def invoke_agent(name: str, payload: dict):
    """Proxy a call to the deployed agent's /invoke endpoint.

    Returns the agent result plus a run_id for trace correlation.
    The run_id can be used with GET /agents/{name}/runs/{run_id}/events.
    """
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"agent {name!r} not registered")
    if rec.get("status") != "deployed":
        raise HTTPException(409, f"agent {name!r} is not deployed (status={rec['status']})")

    run_id = f"run-{uuid.uuid4().hex[:10]}"
    started_at = datetime.now(timezone.utc).isoformat()

    endpoint = rec["endpoint"]
    # Pass run_id into the agent so it can tag LiteLLM calls for trace correlation
    enriched = {**payload, "_run_id": run_id}

    try:
        r = httpx.post(f"{endpoint}/invoke", json=enriched, timeout=120)
        r.raise_for_status()
        result = r.json()
    except httpx.HTTPStatusError as e:
        completed_at = datetime.now(timezone.utc).isoformat()
        _agent_runs[run_id] = {
            "run_id": run_id, "agent_name": name, "status": "error",
            "started_at": started_at, "completed_at": completed_at,
            "service_account_id": rec.get("service_account_id", ""),
        }
        raise HTTPException(e.response.status_code, f"Agent returned error: {e.response.text}")
    except Exception as e:
        raise HTTPException(502, f"Could not reach agent at {endpoint}: {e}")

    completed_at = datetime.now(timezone.utc).isoformat()
    _agent_runs[run_id] = {
        "run_id": run_id,
        "agent_name": name,
        "status": "completed",
        "started_at": started_at,
        "completed_at": completed_at,
        "service_account_id": rec.get("service_account_id", ""),
    }

    return {"result": result, "run_id": run_id}


@router.get("/{name}/runs/{run_id}/events")
def get_run_events(name: str, run_id: str):
    """Fetch audit/trace events for a specific agent invocation.

    Reads LiteLLM events from MinIO in the time window of the run,
    filtered by the agent's service account ID.
    """
    run = _agent_runs.get(run_id)
    if not run:
        raise HTTPException(404, f"run {run_id!r} not found")

    events = audit.read_agent_run_events(
        service_account_id=run["service_account_id"],
        started_at=run["started_at"],
        completed_at=run["completed_at"],
    )

    # Normalise to a frontend-friendly shape
    normalized = []
    for ev in events:
        model = ev.get("model") or ev.get("litellm_params", {}).get("model", "unknown")
        input_tokens = ev.get("usage", {}).get("prompt_tokens") or ev.get("promptTokens")
        output_tokens = ev.get("usage", {}).get("completion_tokens") or ev.get("completionTokens")
        duration_ms = ev.get("duration") or ev.get("endTime") and (
            (datetime.fromisoformat(ev["endTime"]) - datetime.fromisoformat(ev["startTime"])).total_seconds() * 1000
            if ev.get("startTime") else None
        )
        event_type = "tool_call" if ev.get("call_type") == "function" else "llm_call"
        normalized.append({
            "event_type": event_type,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "duration_ms": int(duration_ms) if duration_ms else None,
            "timestamp": ev.get("startTime") or ev.get("timestamp"),
            "tool_name": ev.get("function_name"),
        })

    return {"run_id": run_id, "events": normalized, "raw_count": len(events)}
