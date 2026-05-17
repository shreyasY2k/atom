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

from app.core import audit, codegen, identity, registry_db, deployments_store, minio_store
from app.core.container import LocalDeployManager, WORK_DIR, AGENT_PORT, container_healthy
from app.core.litellm_client import chat_completion
from app.core.schema import AgentSpec

router = APIRouter(prefix="/agents", tags=["agents"])


class DeployRequestBody(BaseModel):
    notes: str = ""
    previous_request_id: str | None = None
    # UI always sends current editor content so spec is saved before any action.
    spec_yaml: str | None = None
    skill_content: str | None = None


class SaveAndDeployBody(BaseModel):
    """Carries the spec + skill content from the UI editor so files are
    written to disk on explicit deploy/save — never auto-saved earlier."""
    spec_yaml: str | None = None      # current YAML from editor
    skill_content: str | None = None  # current role/skill markdown from editor


def _save_spec_files(name: str, spec_yaml: str, skill_content: str | None) -> None:
    """Write spec YAML and role file to disk and mirror both to MinIO draft.

    MinIO is the authoritative source for _do_deploy_agent (disk is the fallback).
    Keeping them in sync ensures user edits made in the UI are what gets deployed.
    Both MinIO writes are fail-open: a transient MinIO error won't abort the deploy.
    """
    spec_dict = yaml.safe_load(spec_yaml)
    spec = AgentSpec.model_validate(spec_dict)

    # Write role/skill file if content provided
    if skill_content:
        for ag in spec.spec.agents:
            role_rel = ag.agent_role_file or f"agent-roles/{spec.metadata.domain}/{name}.role.md"
            # Keep spec_dict in sync
            for node in spec_dict.get("spec", {}).get("agents", []):
                if node.get("name") == ag.name:
                    node["agent_role_file"] = role_rel
                    node.pop("skill", None)
            role_path = Path("/app") / role_rel
            role_path.parent.mkdir(parents=True, exist_ok=True)
            role_path.write_text(skill_content)
        try:
            minio_store.write_draft_role(name, skill_content)
        except Exception:
            pass  # disk copy is the fallback in _do_deploy_agent

    # Write spec YAML (with role path annotations) to disk
    updated_yaml = yaml.dump(spec_dict, sort_keys=False, allow_unicode=True)
    spec_file = SPECS_PATH / "agents" / f"{name}.yaml"
    spec_file.parent.mkdir(parents=True, exist_ok=True)
    spec_file.write_text(updated_yaml)
    try:
        minio_store.write_draft_spec(name, updated_yaml)
    except Exception:
        pass  # disk copy is the fallback in _do_deploy_agent

SPECS_PATH  = Path(os.environ.get("SPECS_PATH", "/app/specs"))
LITELLM_BASE_URL = os.environ.get("LITELLM_BASE_URL", "http://litellm:4000")
REME_URL         = os.environ.get("REME_URL", "http://reme:8002")

# Mock service URLs to inject into agent containers
_AGENT_ENV_BASE = {k: v for k, v in os.environ.items() if k.endswith("_URL") or k.endswith("_SVC_URL")}


def _load_spec(name: str) -> tuple[AgentSpec, dict]:
    """Load spec — tries MinIO draft first, falls back to local disk for backward compat."""
    # Try MinIO draft first (new flow)
    if minio_store.draft_exists(name):
        try:
            return _parse_spec_yaml(minio_store.read_draft_spec(name))
        except Exception:
            pass
    # Fall back to disk (legacy agents deployed before MinIO migration)
    spec_path = SPECS_PATH / "agents" / f"{name}.yaml"
    if not spec_path.exists():
        raise HTTPException(404, f"No spec found for agent '{name}'. Use the Generate step first.")
    return _parse_spec_yaml(spec_path.read_text())


def _parse_spec_yaml(raw: str) -> tuple[AgentSpec, dict]:
    try:
        spec_dict = yaml.safe_load(raw)
        spec = AgentSpec.model_validate(spec_dict)
        return spec, spec_dict
    except (yaml.YAMLError, ValidationError) as e:
        raise HTTPException(422, f"Spec parse/validation error: {e}")


# ---------------------------------------------------------------------------
# POST /agents/{name}/compile
# ---------------------------------------------------------------------------

@router.post("/{name}/compile")
def compile_agent(name: str, body: SaveAndDeployBody = SaveAndDeployBody(), request: Request = None):
    """Generate and validate agent.py from the spec.
    If spec_yaml is provided in the body, save to disk first."""
    if body.spec_yaml:
        _save_spec_files(name, body.spec_yaml, body.skill_content)
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

    # Write role markdown from MinIO onto local disk so container build context
    # can copy it into the image (agent.py reads it at runtime from /app/agent-roles/).
    try:
        role_md = minio_store.read_draft_role(name)
        if role_md:
            role_rel = f"agent-roles/general/{name}.role.md"
            for ag in spec.spec.agents:
                if ag.agent_role_file:
                    role_rel = ag.agent_role_file
                    break
            role_local = Path("/app") / role_rel
            role_local.parent.mkdir(parents=True, exist_ok=True)
            role_local.write_text(role_md)
    except Exception:
        pass

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
    # Inject memory config so the generated agent's hydrate_memory / persist_memory
    # functions know which kind of cross-conversation store to use.
    mem = spec.spec.agents[0].memory
    if mem and mem.cross_conversation and mem.cross_conversation.enabled:
        cc = mem.cross_conversation
        # identity_field in spec is a path like "input.customer_id".
        # The generated agent receives the payload directly (no "input." nesting),
        # so strip the prefix before injecting.
        identity_field = cc.identity_field or ""
        if identity_field.startswith("input."):
            identity_field = identity_field[len("input."):]
        env["AGENT_MEMORY_KIND"] = cc.kind or ""
        env["AGENT_MEMORY_IDENTITY_FIELD"] = identity_field
        env["AGENT_MEMORY_TASK_KEY"] = cc.task_key or ""
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

    # Mint immutable versioned copy in MinIO
    agent_rec = registry_db.get(name)
    new_version_count = (agent_rec.get("version_count") or 0) + 1
    role_md = minio_store.read_draft_role(name)
    minio_store.write_versioned(name, new_version_count, spec_yaml_text, role_md)
    try:
        with registry_db._cursor() as cur:
            cur.execute("UPDATE agents SET version_count=%s WHERE name=%s", (new_version_count, name))
    except Exception:
        pass

    return {k: v for k, v in record.items() if k != "virtual_key"}


# ---------------------------------------------------------------------------
# POST /agents/{name}/deploy  (direct, no approval gate)
# ---------------------------------------------------------------------------

@router.post("/{name}/deploy")
def deploy_agent(name: str, body: SaveAndDeployBody = SaveAndDeployBody(), request: Request = None):
    """Save spec+skill to disk (if provided by UI editor), then compile and deploy."""
    actor = (request.headers.get("X-Atom-Actor", "user:default@atom.io") if request else "user:default@atom.io")
    if body.spec_yaml:
        _save_spec_files(name, body.spec_yaml, body.skill_content)
    return _do_deploy_agent(name, actor)


# ---------------------------------------------------------------------------
# POST /agents/{name}/deploy-request  (submit for approval)
# POST /agents/{name}/deploy-direct   (admin bypass — deploys immediately)
# GET  /agents/{name}/deployments     (history)
# ---------------------------------------------------------------------------

@router.post("/{name}/deploy-request")
def deploy_request(name: str, body: DeployRequestBody, request: Request):
    """Submit a deployment request. Approver must approve before the agent deploys."""
    if body.spec_yaml:
        _save_spec_files(name, body.spec_yaml, body.skill_content)
    spec, spec_dict = _load_spec(name)
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
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
    if body.spec_yaml:
        _save_spec_files(name, body.spec_yaml, body.skill_content)
    spec, spec_dict = _load_spec(name)
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
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
def invoke_agent(name: str, payload: dict, background_tasks: BackgroundTasks):
    """Proxy a call to the deployed agent's /invoke endpoint.

    Returns immediately after the agent responds.
    Studio registration and run-record updates run in the background.
    """
    rec = registry_db.get(name)
    if not rec:
        raise HTTPException(404, f"agent {name!r} not registered")
    if rec.get("status") != "deployed":
        raise HTTPException(409, f"agent {name!r} is not deployed (status={rec['status']})")

    run_id = f"run-{uuid.uuid4().hex[:10]}"
    started_at = datetime.now(timezone.utc).isoformat()
    endpoint = rec["endpoint"]
    enriched = {**payload, "_run_id": run_id}

    try:
        r = httpx.post(f"{endpoint}/invoke", json=enriched, timeout=120)
        r.raise_for_status()
        result = r.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Agent returned error: {e.response.text}")
    except Exception as e:
        raise HTTPException(502, f"Could not reach agent at {endpoint}: {e}")

    completed_at = datetime.now(timezone.utc).isoformat()

    # ── Background: DB persistence + Studio registration ──────────────────────
    # These never block the response — they run after the result is sent.
    import json as _json
    user_text = payload.get("text") or _json.dumps(
        {k: v for k, v in payload.items() if k != "_run_id"}, default=str
    )
    agent_text = _json.dumps(result, default=str) if isinstance(result, dict) else str(result)
    svc_id = rec.get("service_account_id", "")

    def _persist_and_register():
        registry_db.upsert_run({
            "run_id": run_id, "agent_name": name, "status": "completed",
            "started_at": started_at, "completed_at": completed_at,
            "service_account_id": svc_id,
            "user_message": user_text[:2000],
            "agent_response": agent_text[:4000],
        })
        _register_with_studio(
            run_id=run_id, agent_name=name, svc_id=svc_id,
            user_input=payload, agent_output=result,
            started_at=started_at, completed_at=completed_at,
        )

    background_tasks.add_task(_persist_and_register)

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
    """Call a Studio tRPC mutation. Runs in background — never blocks the critical path."""
    try:
        httpx.post(
            f"{STUDIO_URL}/api/trpc/{procedure}",
            json={"json": data},
            headers={"Content-Type": "application/json"},
            timeout=1.5,   # short — already in background, don't hang
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


# ===========================================================================
# New provisioning flow
# ===========================================================================

class ProvisionBody(BaseModel):
    name: str
    description: str = ""


class AgentToolBody(BaseModel):
    name: str
    display_name: str | None = None
    description: str = ""
    endpoint: str | None = None
    method: str = "POST"
    input_schema: dict = {}
    output_schema: dict = {}
    tags: list[str] = []
    tool_id: str | None = None  # if set, associate an existing global tool


class AssociateToolBody(BaseModel):
    tool_id: str


class SkillBody(BaseModel):
    name: str
    content: str


class GenerateBody(BaseModel):
    behavior: str


class RegisterLocalBody(BaseModel):
    endpoint: str


# ---------------------------------------------------------------------------
# POST /agents  — provision (Step 1)
# ---------------------------------------------------------------------------

@router.post("")
def provision_agent(body: ProvisionBody, request: Request):
    """Create agent record + LiteLLM key immediately. Status: provisioned."""
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    existing = registry_db.get(body.name)
    if existing:
        raise HTTPException(409, f"Agent '{body.name}' already exists")

    try:
        svc_id, vkey = identity.provision_identity(body.name, owner=actor)
    except Exception as e:
        raise HTTPException(502, f"Identity provisioning failed: {e}")

    now = datetime.now(timezone.utc).isoformat()
    record = {
        "name": body.name, "description": body.description,
        "version": "v0", "service_account_id": svc_id, "virtual_key": vkey,
        "owner": actor, "deployed_at": now, "endpoint": None, "container_id": None,
        "spec_hash": None, "code_hash": None, "status": "provisioned",
        "version_count": 0,
    }
    registry_db.upsert(record)
    audit.emit(f"provision/{body.name}", {
        "actor_type": "human", "actor_id": actor,
        "action": "provision_agent", "target": body.name,
    })
    return {k: v for k, v in record.items() if k != "virtual_key"}


# ---------------------------------------------------------------------------
# Tools (Step 2)
# ---------------------------------------------------------------------------

@router.get("/{name}/tools")
def list_agent_tools(name: str):
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    return {"tools": registry_db.get_agent_tools(name)}


@router.post("/{name}/tools")
def add_agent_tool(name: str, body: AgentToolBody, request: Request):
    """Add an agent-specific tool OR associate an existing global tool."""
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    now = datetime.now(timezone.utc).isoformat()

    if body.tool_id:
        registry_db.associate_tool(name, body.tool_id)
    else:
        tool_id = str(uuid.uuid4())
        registry_db.upsert_tool({
            "tool_id": tool_id, "name": body.name,
            "display_name": body.display_name or body.name,
            "description": body.description, "scope": "agent",
            "owner_agent": name, "endpoint": body.endpoint,
            "method": body.method, "input_schema": body.input_schema,
            "output_schema": body.output_schema, "tags": body.tags,
            "created_by": actor, "created_at": now, "updated_at": now,
        })
        registry_db.associate_tool(name, tool_id)

    tools = registry_db.get_agent_tools(name)
    try:
        identity.update_identity_tools(agent["virtual_key"], [t["name"] for t in tools])
    except Exception:
        pass
    return {"tools": tools}


@router.post("/{name}/tools/associate")
def associate_global_tool(name: str, body: AssociateToolBody, request: Request):
    """Link an existing global tool to this agent."""
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    registry_db.associate_tool(name, body.tool_id)
    tools = registry_db.get_agent_tools(name)
    try:
        identity.update_identity_tools(agent["virtual_key"], [t["name"] for t in tools])
    except Exception:
        pass
    return {"tools": tools}


@router.delete("/{name}/tools/{tool_id}")
def remove_agent_tool(name: str, tool_id: str, request: Request):
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    registry_db.dissociate_tool(name, tool_id)
    tools = registry_db.get_agent_tools(name)
    try:
        identity.update_identity_tools(agent["virtual_key"], [t["name"] for t in tools])
    except Exception:
        pass
    return {"tools": tools}


# ---------------------------------------------------------------------------
# Skills (Step 2)
# ---------------------------------------------------------------------------

@router.get("/{name}/skills")
def list_skills(name: str):
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    return {"skills": agent.get("skills") or []}


@router.post("/{name}/skills")
def upsert_skill(name: str, body: SkillBody, request: Request):
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    skills = [s for s in (agent.get("skills") or []) if s["name"] != body.name]
    skills.append({"name": body.name, "content": body.content})
    registry_db.update_skills(name, skills)
    return {"skills": skills}


@router.delete("/{name}/skills/{skill_name}")
def delete_skill(name: str, skill_name: str):
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    skills = [s for s in (agent.get("skills") or []) if s["name"] != skill_name]
    registry_db.update_skills(name, skills)
    return {"skills": skills}


# ---------------------------------------------------------------------------
# Generate spec + role via LLM (Step 3)
# ---------------------------------------------------------------------------

@router.post("/{name}/generate")
def generate_agent(name: str, body: GenerateBody, request: Request):
    """LLM generates role markdown + spec YAML. Saves draft to MinIO."""
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")

    tools = registry_db.get_agent_tools(name)
    skills = agent.get("skills") or []

    tools_desc = "\n".join(
        f"- {t['name']}: {t.get('description', '')} — endpoint: {t.get('endpoint', 'n/a')}"
        for t in tools
    ) or "No tools defined yet."

    skills_list = "\n".join(f"- {s['name']}" for s in skills) or "None."

    prompt = f"""You are generating configuration for an AI agent on the Atom Platform.

Agent name: {name}
Description: {agent.get('description', '')}
Behavior instructions: {body.behavior}

Tools available to this agent:
{tools_desc}

Skills:
{skills_list}

Produce exactly two sections separated by the delimiters below.

---ROLE---
Write a concise agent-role markdown file (200-400 words) covering:
# {name}
A persona statement, ## Process (numbered steps referencing the tools), ## Output format (JSON block), ## Critical rules.

---SPEC---
Write a valid atom.platform/v1 AgentDeployment YAML spec. Use this structure:
apiVersion: atom.platform/v1
kind: AgentDeployment
metadata:
  name: {name}
  domain: general
  version: "0.1.0"
  description: <one line>
  owner: {agent.get('owner', 'user:default@atom.io')}
spec:
  agents:
    - name: {name}-agent
      role: standalone
      agent_role_file: agent-roles/general/{name}.role.md
      model: gemini-3.1-pro
      temperature: 1.0
      reasoning_effort: medium
      max_iterations: 6
      tools: {[t['name'] for t in tools]}
      memory:
        type: short_term
        cross_conversation:
          enabled: true
          kind: task
          task_key: {name}-memory
          identity_field: input.workspace_id
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/{name}
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1

IMPORTANT: Always include the memory section exactly as shown. This enables ReMe cross-conversation memory so the agent can remember past interactions per workspace_id.
"""

    try:
        response = chat_completion(
            messages=[{"role": "user", "content": prompt}],
            model="gemini-3-flash",
            reasoning_effort="low",
        )
    except Exception as e:
        raise HTTPException(502, f"LLM generation failed: {e}")

    role_md = ""
    spec_yaml = ""
    if "---ROLE---" in response and "---SPEC---" in response:
        parts = response.split("---SPEC---", 1)
        role_md = parts[0].replace("---ROLE---", "").strip()
        spec_yaml = parts[1].strip()
    else:
        role_md = f"# {name}\n\n{agent.get('description', '')}\n\n## Behavior\n\n{body.behavior}\n"
        spec_yaml = _make_minimal_spec(name, agent, tools)

    minio_store.write_draft_spec(name, spec_yaml)
    minio_store.write_draft_role(name, role_md)

    try:
        with registry_db._cursor() as cur:
            cur.execute("UPDATE agents SET status='draft' WHERE name=%s", (name,))
    except Exception:
        pass

    return {"spec_yaml": spec_yaml, "role_md": role_md, "status": "draft"}


def _make_minimal_spec(name: str, agent: dict, tools: list) -> str:
    return yaml.dump({
        "apiVersion": "atom.platform/v1",
        "kind": "AgentDeployment",
        "metadata": {
            "name": name, "domain": "general", "version": "0.1.0",
            "description": agent.get("description", ""),
            "owner": agent.get("owner", "user:default@atom.io"),
        },
        "spec": {
            "agents": [{
                "name": f"{name}-agent", "role": "standalone",
                "agent_role_file": f"agent-roles/general/{name}.role.md",
                "model": "gemini-3.1-pro", "temperature": 1.0,
                "reasoning_effort": "medium", "max_iterations": 6,
                "tools": [t["name"] for t in tools],
                "memory": {
                    "type": "short_term",
                    "cross_conversation": {
                        "enabled": True,
                        "kind": "task",
                        "task_key": f"{name}-memory",
                        "identity_field": "input.workspace_id",
                    },
                },
            }],
            "flow": {"type": "standalone"},
            "audit": {"log_to": f"minio://audit-logs/agent/{name}", "retention_days": 90},
            "deployment": {"runtime": "agentscope", "sandbox": "base", "replicas": 1},
        },
    }, sort_keys=False, allow_unicode=True)


# ---------------------------------------------------------------------------
# Edit deployed agent — start new draft (same LiteLLM key)
# ---------------------------------------------------------------------------

@router.post("/{name}/edit")
def start_edit(name: str, request: Request):
    """Copy the latest deployed version to draft so the agent can be edited."""
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    version_count = agent.get("version_count") or 0
    if version_count > 0:
        try:
            spec_yaml = minio_store.read_versioned_spec(name, version_count)
            minio_store.write_draft_spec(name, spec_yaml)
            try:
                role_md = minio_store.read_versioned_role(name, version_count)
                minio_store.write_draft_role(name, role_md)
            except Exception:
                pass
        except Exception:
            pass
    return {"status": "draft_created", "base_version": version_count}


# ---------------------------------------------------------------------------
# Register local dev agent (CLI scaffold workflow)
# ---------------------------------------------------------------------------

@router.post("/{name}/register-local")
def register_local(name: str, body: RegisterLocalBody, request: Request):
    """Register a locally-running agent container so GATE can route to it."""
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    agent = registry_db.get(name)
    now = datetime.now(timezone.utc).isoformat()

    if agent:
        svc_id = agent["service_account_id"]
        vkey = agent["virtual_key"]
    else:
        try:
            svc_id, vkey = identity.provision_identity(name, owner=actor)
        except Exception as e:
            raise HTTPException(502, f"Identity provisioning failed: {e}")

    record = {
        "name": name,
        "description": agent.get("description", "") if agent else "",
        "version": "local",
        "service_account_id": svc_id,
        "virtual_key": vkey,
        "owner": actor,
        "deployed_at": now,
        "endpoint": body.endpoint,
        "container_id": None,
        "spec_hash": "local",
        "code_hash": "local",
        "status": "deployed",
        "version_count": agent.get("version_count", 0) if agent else 0,
    }
    registry_db.upsert(record)
    audit.emit(f"register-local/{name}", {
        "actor_type": "human", "actor_id": actor,
        "action": "register_local", "target": name,
        "endpoint": body.endpoint,
    })
    return {k: v for k, v in record.items() if k != "virtual_key"}
