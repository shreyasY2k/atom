"""Routes: agent sessions — stateful multi-turn conversations with ReMe memory."""

import json
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from pydantic import BaseModel

from app.core import audit, registry_db, reme_client, file_processor
import boto3, os as _os

router = APIRouter(prefix="/agents", tags=["sessions"])

_AGENT_TIMEOUT = 120


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class CreateSessionBody(BaseModel):
    workspace_id: str | None = None   # entity ID for ReMe (e.g. customer_id)
    metadata: dict = {}


class AttachmentItem(BaseModel):
    type: str = "file"              # "file" | "url"
    file_id: str | None = None      # for type=file
    name: str | None = None
    content_type: str | None = None
    url: str | None = None          # for type=url


class SendMessageBody(BaseModel):
    text: str
    workspace_id: str | None = None
    metadata: dict = {}
    attachments: list[AttachmentItem] = []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _enrich_attachments(attachments: list) -> list:
    """Extract content from file and URL attachments before sending to the agent."""
    enriched = []
    s3 = boto3.client(
        "s3",
        endpoint_url=f"http://{_os.environ.get('MINIO_ENDPOINT', 'minio:9000')}",
        aws_access_key_id=_os.environ.get("MINIO_ACCESS_KEY", "minioadmin"),
        aws_secret_access_key=_os.environ.get("MINIO_SECRET_KEY", "minioadmin"),
        region_name="us-east-1",
    )
    for att in attachments:
        item = att.model_dump() if hasattr(att, "model_dump") else dict(att)
        try:
            if item.get("type") == "file" and item.get("file_id"):
                fid = item["file_id"]
                meta_obj = s3.get_object(Bucket="uploaded-documents", Key=f"{fid}/_meta.json")
                meta = json.loads(meta_obj["Body"].read())
                file_obj = s3.get_object(Bucket="uploaded-documents", Key=meta["minio_key"])
                data = file_obj["Body"].read()
                extracted = file_processor.extract(data, meta["content_type"], meta["original_name"])
                item["extracted_text"] = extracted.get("text", "")
                item["extract_format"] = extracted.get("format", "unknown")
                item["name"] = item.get("name") or meta["original_name"]
            elif item.get("type") == "url" and item.get("url"):
                extracted = file_processor.extract_url(item["url"])
                item["extracted_text"] = extracted.get("text", "")
                item["extract_format"] = extracted.get("format", "url")
        except Exception:
            item["extracted_text"] = "[Content extraction failed]"
        enriched.append(item)
    return enriched


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_agent_or_404(name: str) -> dict:
    agent = registry_db.get(name)
    if not agent:
        raise HTTPException(404, f"Agent '{name}' not found")
    return agent


def _require_session(session_id: str, agent_name: str) -> dict:
    s = registry_db.get_session(session_id)
    if not s:
        raise HTTPException(404, f"Session '{session_id}' not found")
    if s["agent_name"] != agent_name:
        raise HTTPException(400, "Session does not belong to this agent")
    if s["status"] == "ended":
        raise HTTPException(409, "Session has ended")
    return s


def _history_to_messages(messages: list[dict]) -> list[dict]:
    """Convert DB message rows to LLM-style {role, content} dicts."""
    return [{"role": m["role"], "content": m["content"]} for m in messages]


def _bg_summarise(session_id: str, agent_name: str, workspace_id: str | None) -> None:
    """Background: build a plain-text summary of the session and write to ReMe."""
    if not workspace_id:
        return
    try:
        msgs = registry_db.get_session_messages(session_id)
        if not msgs:
            return
        lines = [f"{m['role'].upper()}: {m['content']}" for m in msgs]
        summary = f"[Session {session_id} — Agent {agent_name}]\n" + "\n".join(lines)
        reme_client.summarise(summary, workspace_id)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# POST /agents/{name}/sessions  — create session
# ---------------------------------------------------------------------------

@router.post("/{name}/sessions")
def create_session(name: str, body: CreateSessionBody, request: Request):
    """Create a new conversational session. Optionally retrieves ReMe context."""
    agent = _get_agent_or_404(name)
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    now = _now()
    session_id = f"sess-{uuid.uuid4().hex[:12]}"

    # Retrieve long-term memories for this workspace (entity)
    reme_context: str | None = None
    if body.workspace_id:
        memories = reme_client.retrieve(
            query=f"context for agent {name}",
            workspace_id=body.workspace_id,
        )
        if memories:
            reme_context = reme_client.format_memories_as_context(memories)

    session = registry_db.create_session({
        "session_id": session_id,
        "agent_name": name,
        "owner": actor,
        "created_at": now,
        "updated_at": now,
        "status": "active",
        "reme_context": reme_context,
        "metadata": {**body.metadata, "workspace_id": body.workspace_id},
    })

    audit.emit(f"session/{name}", {
        "actor_type": "human", "actor_id": actor,
        "action": "create_session", "agent": name,
        "session_id": session_id, "has_reme_context": reme_context is not None,
    })

    return {**session, "message_count": 0}


# ---------------------------------------------------------------------------
# GET /agents/{name}/sessions  — list sessions
# ---------------------------------------------------------------------------

@router.get("/{name}/sessions")
def list_sessions(name: str, request: Request, limit: int = 50):
    _get_agent_or_404(name)
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    sessions = registry_db.list_sessions(name, limit=limit)
    return {"sessions": sessions, "total": len(sessions)}


# ---------------------------------------------------------------------------
# GET /agents/{name}/sessions/{session_id}  — get session + messages
# ---------------------------------------------------------------------------

@router.get("/{name}/sessions/{session_id}")
def get_session(name: str, session_id: str):
    _get_agent_or_404(name)
    # GET is read-only — return ended sessions too (don't use _require_session)
    session = registry_db.get_session(session_id)
    if not session:
        raise HTTPException(404, f"Session '{session_id}' not found")
    if session["agent_name"] != name:
        raise HTTPException(400, "Session does not belong to this agent")
    messages = registry_db.get_session_messages(session_id)
    return {**session, "messages": messages, "message_count": len(messages)}


# ---------------------------------------------------------------------------
# POST /agents/{name}/sessions/{session_id}/messages  — send a message
# ---------------------------------------------------------------------------

@router.post("/{name}/sessions/{session_id}/messages")
def send_message(
    name: str,
    session_id: str,
    body: SendMessageBody,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Send a user message in a session. Injects history + ReMe context into the agent call."""
    agent = _get_agent_or_404(name)
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    session = _require_session(session_id, name)

    if agent.get("status") != "deployed":
        raise HTTPException(409, f"Agent '{name}' is not deployed (status={agent['status']})")

    endpoint = agent.get("endpoint")
    if not endpoint:
        raise HTTPException(502, f"Agent '{name}' has no endpoint registered")

    now = _now()
    run_id = f"run-{uuid.uuid4().hex[:10]}"

    # Persist user message
    user_msg = registry_db.append_message({
        "message_id": f"msg-{uuid.uuid4().hex[:10]}",
        "session_id": session_id,
        "role": "user",
        "content": body.text,
        "created_at": now,
        "run_id": run_id,
        "metadata": body.metadata,
    })

    # Build history for context
    history = registry_db.get_session_messages(session_id)
    prior = history[:-1]  # exclude the just-added user msg
    messages = _history_to_messages(prior)

    reme_context = session.get("reme_context") or ""
    workspace_id = body.workspace_id or (
        (session.get("metadata") or {}).get("workspace_id")
    )

    # Build a history-enriched text so legacy agents (which only read `text`)
    # still see the full conversation context. New agents can use `messages[]`.
    #
    # Exclude guardrail-blocked turns from history — including them re-injects
    # the original attack text into subsequent calls and causes false positives.
    if prior:
        clean_prior = []
        i = 0
        while i < len(prior):
            m = prior[i]
            # Skip user messages whose NEXT message is a guardrail block
            if m["role"] == "user" and i + 1 < len(prior):
                nxt = prior[i + 1]
                if nxt["role"] == "assistant" and "guardrail_violation" in nxt.get("content", ""):
                    i += 2  # skip this user msg + the following blocked assistant msg
                    continue
            # Skip standalone guardrail assistant messages
            if m["role"] == "assistant" and "guardrail_violation" in m.get("content", ""):
                i += 1
                continue
            clean_prior.append(m)
            i += 1

        history_lines = []
        for m in clean_prior[-12:]:  # last 12 clean turns
            role_label = "User" if m["role"] == "user" else "Assistant"
            content_preview = m["content"][:600]
            if len(m["content"]) > 600:
                content_preview += "…"
            history_lines.append(f"{role_label}: {content_preview}")
        history_block = "\n".join(history_lines) if history_lines else ""
        if history_block and reme_context:
            enriched_text = f"{reme_context}\n\n[Conversation so far]\n{history_block}\n\n[Current message]\n{body.text}"
        elif history_block:
            enriched_text = f"[Conversation so far]\n{history_block}\n\n[Current message]\n{body.text}"
        elif reme_context:
            enriched_text = f"{reme_context}\n\n[Current message]\n{body.text}"
        else:
            enriched_text = body.text
    elif reme_context:
        enriched_text = f"{reme_context}\n\n[Current message]\n{body.text}"
    else:
        enriched_text = body.text

    invoke_payload = {
        "text": enriched_text,                   # history-enriched — works for all agents
        "session_id": session_id,
        "run_id": run_id,
        "messages": messages,                    # structured history for session-aware agents
        "reme_context": reme_context,
        "workspace_id": workspace_id,
        "attachments": _enrich_attachments(body.attachments or []),
    }

    # Call agent container
    try:
        resp = httpx.post(
            f"{endpoint}/invoke",
            json=invoke_payload,
            headers={
                "X-Atom-Actor": actor,
                "X-Session-ID": session_id,
                "X-Gate-Run-ID": run_id,
            },
            timeout=_AGENT_TIMEOUT,
        )
        resp.raise_for_status()
        result = resp.json()
    except httpx.HTTPStatusError as e:
        raise HTTPException(e.response.status_code, f"Agent error: {e.response.text}")
    except Exception as e:
        raise HTTPException(502, f"Could not reach agent at {endpoint}: {e}")

    # Extract assistant response text
    assistant_content = (
        result.get("result") or result.get("response") or result.get("text") or
        json.dumps(result, default=str)
    )
    if isinstance(assistant_content, dict):
        assistant_content = json.dumps(assistant_content, default=str)

    # Persist assistant response
    registry_db.append_message({
        "message_id": f"msg-{uuid.uuid4().hex[:10]}",
        "session_id": session_id,
        "role": "assistant",
        "content": str(assistant_content),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "run_id": run_id,
        "metadata": {},
    })

    # Background: persist run record + optionally update ReMe
    def _persist():
        registry_db.upsert_run({
            "run_id": run_id, "agent_name": name,
            "service_account_id": agent.get("service_account_id", ""),
            "started_at": now, "completed_at": datetime.now(timezone.utc).isoformat(),
            "status": "completed",
            "user_message": body.text[:2000],
            "agent_response": str(assistant_content)[:4000],
        })

    background_tasks.add_task(_persist)

    audit.emit(f"session/{name}", {
        "actor_type": "human", "actor_id": actor,
        "action": "send_message", "agent": name,
        "session_id": session_id, "run_id": run_id,
    })

    return {
        "session_id": session_id,
        "run_id": run_id,
        "role": "assistant",
        "content": assistant_content,
        "result": result,
    }


# ---------------------------------------------------------------------------
# DELETE /agents/{name}/sessions/{session_id}  — end session
# ---------------------------------------------------------------------------

@router.delete("/{name}/sessions/{session_id}")
def end_session(name: str, session_id: str, request: Request, background_tasks: BackgroundTasks):
    """End a session and trigger background ReMe summarisation."""
    _get_agent_or_404(name)
    actor = request.headers.get("X-Atom-Actor", "user:default@atom.io")
    session = _require_session(session_id, name)

    registry_db.update_session_status(session_id, "ended", _now())

    workspace_id = (session.get("metadata") or {}).get("workspace_id")
    background_tasks.add_task(_bg_summarise, session_id, name, workspace_id)

    audit.emit(f"session/{name}", {
        "actor_type": "human", "actor_id": actor,
        "action": "end_session", "agent": name, "session_id": session_id,
    })

    return {"session_id": session_id, "status": "ended"}


# ---------------------------------------------------------------------------
# GET /agents/{name}/swagger  — OpenAPI spec proxy
# ---------------------------------------------------------------------------

@router.get("/{name}/swagger")
def get_swagger(name: str):
    """Fetch the agent container's auto-generated OpenAPI spec."""
    import socket
    agent = _get_agent_or_404(name)
    if agent.get("status") != "deployed":
        raise HTTPException(409, f"Agent '{name}' is not deployed (status={agent.get('status')})")
    endpoint = agent.get("endpoint")
    if not endpoint:
        raise HTTPException(502, "Agent has no endpoint recorded — it may need to be redeployed")
    try:
        resp = httpx.get(f"{endpoint}/openapi.json", timeout=10)
        resp.raise_for_status()
        spec = resp.json()
        spec.setdefault("info", {})
        spec["info"]["x-atom-agent"] = name
        spec["info"]["x-atom-service-account"] = agent.get("service_account_id")
        spec["info"]["x-atom-version"] = agent.get("version")
        return spec
    except (httpx.ConnectError, socket.gaierror, OSError) as e:
        raise HTTPException(503, (
            f"Agent container at {endpoint} is not reachable. "
            "The container may have stopped after a platform restart — redeploy the agent to restore it."
        ))
    except httpx.TimeoutException:
        raise HTTPException(504, f"Agent at {endpoint} did not respond within 10s")
    except Exception as e:
        raise HTTPException(502, f"Could not fetch OpenAPI spec: {e}")
