"""Routes: compile, deploy, invoke, run events."""

import hashlib
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel, ValidationError

from app.core import audit, codegen, identity, registry_db, deployments_store
from app.core.container import LocalDeployManager, WORK_DIR, AGENT_PORT, container_healthy
from app.core.schema import AgentSpec

router = APIRouter(prefix="/agents", tags=["agents"])


class DeployRequestBody(BaseModel):
    notes: str = ""
    previous_request_id: str | None = None

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
def compile_agent(name: str, request: Request):
    """Generate and validate agent.py from the spec."""
    spec, spec_dict = _load_spec(name)
    actor = request.headers.get("X-Atom-Actor", spec.metadata.owner)

    try:
        code = codegen.compile_agent(name, spec, spec_dict)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(502, f"Code generation failed: {e}")

    chash = codegen.code_hash(code)
    audit.emit_build(name=name, owner=actor)

    return {
        "name": name,
        "version": spec.metadata.version,
        "code_hash": chash,
        "code_length": len(code),
        "code": code,
    }


# ---------------------------------------------------------------------------
# Core deploy logic — called by /deploy, /deploy-direct, and approval tasks
# ---------------------------------------------------------------------------

def _do_deploy_agent(name: str, actor: str) -> dict:
    """Build container, issue identity, register. Raises HTTPException on failure."""
    spec, spec_dict = _load_spec(name)

    try:
        code = codegen.compile_agent(name, spec, spec_dict)
    except (ValueError, Exception) as e:
        raise HTTPException(502, f"Code generation failed: {e}")

    chash = codegen.code_hash(code)
    spec_hash = hashlib.sha256(
        yaml.dump(spec_dict, sort_keys=True).encode()
    ).hexdigest()[:16]

    existing = registry_db.get(name)
    if existing and existing.get("virtual_key"):
        try:
            identity.revoke_identity(existing["virtual_key"])
        except Exception:
            pass

    try:
        svc_id, vkey = identity.issue_identity(name, spec_dict, spec, owner=actor)
    except Exception as e:
        raise HTTPException(502, f"Identity issuance failed: {e}")

    registry_db.upsert({
        "name": name, "version": spec.metadata.version,
        "service_account_id": svc_id, "virtual_key": vkey,
        "owner": actor, "deployed_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": None, "container_id": None,
        "spec_hash": spec_hash, "code_hash": chash, "status": "deploying",
    })

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
            name=name, version=spec.metadata.version,
            agent_code=code, port=AGENT_PORT, env=env,
        )
        endpoint = deploy_result["endpoint"]
    except Exception as e:
        try:
            identity.revoke_identity(vkey)
        except Exception:
            pass
        raise HTTPException(502, f"Container build/run failed: {e}")

    healthy = False
    for _ in range(30):
        if container_healthy(endpoint):
            healthy = True
            break
        time.sleep(1)

    if not healthy:
        raise HTTPException(502, "Agent container started but /health never returned 200")

    now = datetime.now(timezone.utc).isoformat()
    agent_role_name = spec.spec.agents[0].name if spec.spec.agents else None
    record = {
        "name": name, "version": spec.metadata.version,
        "service_account_id": svc_id, "virtual_key": vkey,
        "owner": actor, "deployed_at": now, "endpoint": endpoint,
        "container_id": None, "spec_hash": spec_hash, "code_hash": chash,
        "status": "deployed", "agent_role_name": agent_role_name,
    }
    registry_db.upsert(record)

    audit.emit_deploy(name=name, service_account_id=svc_id, version=spec.metadata.version)
    audit.emit_build(name=name, owner=actor, action="deploy_agent")

    spec_yaml_text = yaml.dump(spec_dict, sort_keys=False, allow_unicode=True)
    audit.write_agent_artifact(
        name=name, version=spec.metadata.version,
        agent_code=code, spec_yaml=spec_yaml_text,
        metadata={k: v for k, v in record.items() if k != "virtual_key"},
    )
    audit.write_agent_spec(name=name, version=spec.metadata.version, spec_yaml=spec_yaml_text)

    return {k: v for k, v in record.items() if k != "virtual_key"}


# ---------------------------------------------------------------------------
# POST /agents/{name}/deploy  (direct, no approval gate)
# ---------------------------------------------------------------------------

@router.post("/{name}/deploy")
def deploy_agent(name: str, request: Request):
    """Compile (if needed), issue identity, build+run container, register."""
    actor = request.headers.get("X-Atom-Actor", "user:demo@atom.demo")
    return _do_deploy_agent(name, actor)


# ---------------------------------------------------------------------------
# POST /agents/{name}/deploy-request  (submit for approval)
# POST /agents/{name}/deploy-direct   (admin bypass — deploys immediately)
# GET  /agents/{name}/deployments     (history)
# ---------------------------------------------------------------------------

@router.post("/{name}/deploy-request")
def deploy_request(name: str, body: DeployRequestBody, request: Request):
    """Submit a deployment request. Approver must approve before the agent deploys."""
    spec, spec_dict = _load_spec(name)
    actor = request.headers.get("X-Atom-Actor", "user:demo@atom.demo")
    spec_hash = "sha256:" + hashlib.sha256(
        yaml.dump(spec_dict, sort_keys=True).encode()
    ).hexdigest()

    record = deployments_store.create_record({
        "target_type": "agent",
        "target_name": name,
        "target_version": spec.metadata.version,
        "spec_hash": spec_hash,
        "requested_by": actor,
        "approval_status": "pending",
        "deploy_status": "pending",
        "notes": body.notes,
        "previous_request_id": body.previous_request_id,
    })
    deployments_store.emit_deployment_audit("deployment_requested", record, actor)
    return record


@router.post("/{name}/deploy-direct")
def deploy_direct(name: str, body: DeployRequestBody, request: Request, background_tasks: BackgroundTasks):
    """Platform Admin bypass — create record + deploy immediately, no approval needed."""
    spec, spec_dict = _load_spec(name)
    actor = request.headers.get("X-Atom-Actor", "user:demo@atom.demo")
    spec_hash = "sha256:" + hashlib.sha256(
        yaml.dump(spec_dict, sort_keys=True).encode()
    ).hexdigest()

    record = deployments_store.create_record({
        "target_type": "agent",
        "target_name": name,
        "target_version": spec.metadata.version,
        "spec_hash": spec_hash,
        "requested_by": actor,
        "approval_status": "bypassed",
        "approved_by": actor,
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "deploy_status": "deploying",
        "notes": body.notes,
    })
    deployments_store.emit_deployment_audit("deployment_bypassed", record, actor,
                                            notes="Admin bypass deploy")
    background_tasks.add_task(_bg_deploy_agent, record["deployment_id"], name, actor)
    return record


@router.get("/{name}/deployments")
def list_agent_deployments(name: str):
    """Deployment history for one agent."""
    return {"deployments": deployments_store.list_records(target_type="agent", target_name=name)}


# ---------------------------------------------------------------------------
# Background deploy task (called after approval or bypass)
# ---------------------------------------------------------------------------

def _bg_deploy_agent(deployment_id: str, name: str, actor: str) -> None:
    """Background task: run deploy, update deployment record with outcome."""
    try:
        result = _do_deploy_agent(name, actor)
        deployments_store.update_record(
            deployment_id,
            deploy_status="deployed",
            deployed_at=result.get("deployed_at"),
            service_account_id=result.get("service_account_id"),
            code_hash="sha256:" + (result.get("code_hash") or ""),
        )
        rec = deployments_store.get_record(deployment_id) or {}
        deployments_store.emit_deployment_audit("deployment_completed", rec, "system:builder-backend")
    except Exception as e:
        deployments_store.update_record(deployment_id, deploy_status="failed", deploy_error=str(e))
        rec = deployments_store.get_record(deployment_id) or {}
        deployments_store.emit_deployment_audit("deployment_failed", rec, "system:builder-backend",
                                                notes=str(e))


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

    # Persist the run immediately so it survives restarts
    registry_db.upsert_run({
        "run_id": run_id,
        "agent_name": name,
        "status": "running",
        "started_at": started_at,
        "completed_at": None,
        "service_account_id": rec.get("service_account_id", ""),
    })

    endpoint = rec["endpoint"]
    # Pass run_id into the agent so it can tag LiteLLM calls for trace correlation
    enriched = {**payload, "_run_id": run_id}

    try:
        r = httpx.post(f"{endpoint}/invoke", json=enriched, timeout=120)
        r.raise_for_status()
        result = r.json()
    except httpx.HTTPStatusError as e:
        completed_at = datetime.now(timezone.utc).isoformat()
        registry_db.upsert_run({
            "run_id": run_id, "agent_name": name, "status": "error",
            "started_at": started_at, "completed_at": completed_at,
            "service_account_id": rec.get("service_account_id", ""),
        })
        raise HTTPException(e.response.status_code, f"Agent returned error: {e.response.text}")
    except Exception as e:
        raise HTTPException(502, f"Could not reach agent at {endpoint}: {e}")

    completed_at = datetime.now(timezone.utc).isoformat()
    # Store the actual user message and agent response text for conversation history
    import json as _json
    user_text = payload.get("text") or _json.dumps(
        {k: v for k, v in payload.items() if k != "_run_id"}, default=str
    )
    agent_text = _json.dumps(result, default=str) if isinstance(result, dict) else str(result)
    registry_db.upsert_run({
        "run_id": run_id,
        "agent_name": name,
        "status": "completed",
        "started_at": started_at,
        "completed_at": completed_at,
        "service_account_id": rec.get("service_account_id", ""),
        "user_message": user_text[:2000],
        "agent_response": agent_text[:4000],
    })

    # Register run + messages in Studio so all invocations appear in Studio's UI
    _register_with_studio(
        run_id=run_id,
        agent_name=name,
        svc_id=rec.get("service_account_id", ""),
        user_input=payload,
        agent_output=result,
        started_at=started_at,
        completed_at=completed_at,
    )

    return {"result": result, "run_id": run_id}


@router.get("/{name}/runs")
def list_agent_runs(name: str, limit: int = 50):
    """List recent invocations for an agent. Persisted across restarts."""
    runs = registry_db.list_runs(name, limit)
    return {"runs": runs}


@router.get("/{name}/runs/{run_id}/events")
def get_run_events(name: str, run_id: str):
    """Fetch audit/trace events for a specific agent invocation.

    Reads LiteLLM events from MinIO in the time window of the run,
    filtered by the agent's service account ID.
    """
    run = registry_db.get_run(run_id)
    if not run:
        # Fallback: use the agent's current SA with a broad time window (last 2 hours)
        # This covers runs from before the last restart
        rec = registry_db.get(name)
        if not rec:
            raise HTTPException(404, f"run {run_id!r} not found and agent {name!r} not registered")
        from datetime import datetime, timezone, timedelta
        now = datetime.now(timezone.utc)
        run = {
            "run_id": run_id,
            "agent_name": name,
            "service_account_id": rec.get("service_account_id", ""),
            "started_at": (now - timedelta(hours=2)).isoformat(),
            "completed_at": now.isoformat(),
        }

    events = audit.read_agent_run_events(
        service_account_id=run["service_account_id"],
        started_at=run["started_at"],
        completed_at=run["completed_at"],
    )

    normalized = []
    for ev in events:
        model = ev.get("model") or "unknown"
        # LiteLLM S3 callback stores token counts at top level
        input_tokens = ev.get("prompt_tokens") or ev.get("promptTokens")
        output_tokens = ev.get("completion_tokens") or ev.get("completionTokens")

        # Calculate duration from start/end timestamps (Unix float)
        duration_ms = None
        t0, t1 = ev.get("startTime"), ev.get("endTime")
        if t0 and t1:
            try:
                duration_ms = int((float(t1) - float(t0)) * 1000)
            except Exception:
                pass

        # Extract prompt messages (content may be list of blocks or plain string)
        raw_messages = ev.get("messages", [])
        messages = []
        for m in raw_messages:
            role = m.get("role", "")
            content = m.get("content", "")
            # Normalise content blocks to plain text for display
            if isinstance(content, list):
                text_parts = [
                    block.get("text", "") for block in content
                    if isinstance(block, dict) and block.get("type") == "text"
                ]
                content = "\n".join(text_parts)
            messages.append({"role": role, "content": content})

        # Extract response content from the `response` field.
        # LiteLLM S3 callback may store the response as:
        #   - dict with "choices" array (OpenAI style)
        #   - dict with "content" or "text" at top level
        #   - string (plain text or JSON output)
        response_content = ""
        tool_calls: list[dict] = []
        resp = ev.get("response")

        if isinstance(resp, str):
            response_content = resp

        elif isinstance(resp, dict):
            # Try OpenAI-style choices array
            choices = resp.get("choices") or []
            if choices and isinstance(choices, list):
                msg = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
                rc = msg.get("content") or ""
                if isinstance(rc, list):
                    rc = "\n".join(b.get("text", "") for b in rc if isinstance(b, dict) and b.get("type") == "text")
                response_content = rc or ""
                for tc in (msg.get("tool_calls") or []):
                    fn = tc.get("function", {}) if isinstance(tc, dict) else {}
                    tool_calls.append({"name": fn.get("name", ""), "arguments": fn.get("arguments", "{}")})
            elif "text" in resp:
                response_content = str(resp["text"])
            elif "content" in resp:
                response_content = str(resp["content"])

        event_type = "tool_call" if ev.get("call_type") == "function" else "llm_call"
        normalized.append({
            "event_type": event_type,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "duration_ms": duration_ms,
            "timestamp": ev.get("startTime"),
            "tool_name": ev.get("function_name"),
            "messages": messages,                # full prompt context
            "response_content": response_content[:800],  # truncated for UI
            "tool_calls": tool_calls,
        })

    return {"run_id": run_id, "events": normalized, "raw_count": len(events)}


# ── Studio tRPC integration ────────────────────────────────────────────────────

STUDIO_URL = os.environ.get("STUDIO_URL", "http://studio:3000")


def _studio_trpc(procedure: str, data: dict) -> None:
    """Call a Studio tRPC mutation. Fails silently — never blocks the critical path."""
    try:
        httpx.post(
            f"{STUDIO_URL}/api/trpc/{procedure}",
            json={"json": data},
            headers={"Content-Type": "application/json"},
            timeout=3,
        )
    except Exception:
        pass


def _register_with_studio(
    run_id: str,
    agent_name: str,
    svc_id: str,
    user_input: dict,
    agent_output: dict,
    started_at: str,
    completed_at: str,
) -> None:
    """Register a run + user/agent messages in AgentScope Studio so invocations appear
    in Studio's run list alongside traces captured via agentscope.init()."""
    import json as _json

    # 1. Register the run
    _studio_trpc("registerRun", {
        "id": run_id,
        "project": svc_id,      # Studio groups runs by project = service account ID
        "name": agent_name,
        "timestamp": started_at,
        "pid": 0,
        "status": "FINISHED",
    })

    # 2. Register a reply slot for the user message
    user_reply_id = f"{run_id}-user"
    _studio_trpc("registerReply", {
        "runId": run_id,
        "replyId": user_reply_id,
        "replyRole": "user",
        "replyName": "User",
        "timestamp": started_at,
    })

    # 3. Push user message
    user_content = user_input.get("text") or _json.dumps(
        {k: v for k, v in user_input.items() if k != "_run_id"}, default=str
    )
    _studio_trpc("pushMessage", {
        "runId": run_id,
        "replyId": user_reply_id,
        "replyRole": "user",
        "replyName": "User",
        "msg": {
            "id": f"{run_id}-user-msg",
            "name": "User",
            "role": "user",
            "content": user_content,
            "metadata": None,
            "timestamp": started_at,
        },
    })

    # 4. Register a reply slot for the agent message
    agent_reply_id = f"{run_id}-agent"
    _studio_trpc("registerReply", {
        "runId": run_id,
        "replyId": agent_reply_id,
        "replyRole": "assistant",
        "replyName": agent_name,
        "timestamp": completed_at,
    })

    # 5. Push agent response
    agent_content = _json.dumps(agent_output, default=str) if isinstance(agent_output, dict) else str(agent_output)
    _studio_trpc("pushMessage", {
        "runId": run_id,
        "replyId": agent_reply_id,
        "replyRole": "assistant",
        "replyName": agent_name,
        "msg": {
            "id": f"{run_id}-agent-msg",
            "name": agent_name,
            "role": "assistant",
            "content": agent_content,
            "metadata": {"service_account_id": svc_id},
            "timestamp": completed_at,
        },
    })
