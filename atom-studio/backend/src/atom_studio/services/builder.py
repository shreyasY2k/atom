import logging
import os

logger = logging.getLogger(__name__)

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")
ALWAYS_INCLUDED_SKILLS = ["atom-react-agent", "atom-gate-calls", "atom-audit"]


def _formatter_for_model(_model_name: str) -> tuple[str, str]:
    """Always return OpenAIChatFormatter — AtomChatModel speaks OpenAI format via LiteLLM."""
    return "from agentscope.formatter import OpenAIChatFormatter", "OpenAIChatFormatter()"


def build_agent_py_prompt(
    intent: str,
    model_name: str,
    tools: list[dict],
    skills: list[str],
    a2a_targets: list[dict],
) -> str:
    all_skills = ALWAYS_INCLUDED_SKILLS + [s for s in skills if s not in ALWAYS_INCLUDED_SKILLS]
    skill_context = ""
    for skill_name in all_skills:
        skill_path = os.path.join(SKILLS_DIR, skill_name, "SKILL.md")
        if not os.path.exists(skill_path):
            logger.warning("builder: skill %s not found at %s", skill_name, skill_path)
            continue
        with open(skill_path) as f:
            skill_context += f"\n\n---\n{f.read()}"

    tool_schemas = "\n".join(f"- {t.get('name', '')}: {t.get('description', '')}" for t in tools)
    a2a_list = "\n".join(
        f"- {a.get('name', a.get('id', ''))}: agent_id={a.get('id', '')}" for a in a2a_targets
    )

    return f"""You are generating server.py for an ATOM agent — a FastAPI HTTP server wrapping a ReActAgent.
Follow ALL instructions in the skill documents below EXACTLY.

## Agent intent
{intent}

## Model to use
{model_name}

## MCP Tool functions to implement (register into Toolkit — ReAct loop calls them automatically)
{tool_schemas if tool_schemas else "None — no tools needed"}

## A2A targets (wrap as tool functions using A2AAgent + WellKnownAgentCardResolver)
{a2a_list if a2a_list else "None"}

## ATOM SDK Skills — READ AND FOLLOW EVERY RULE
{skill_context}

## Critical generation rules
1. Generate a FASTAPI SERVER (server.py) — NOT a CLI script.
   The file must have `app = FastAPI()` with `GET /healthz` and `POST /run` endpoints.
2. The CMD in the Dockerfile is `uvicorn server:app --host 0.0.0.0 --port 8080` — NOT `python agent.py`.
3. `agentscope.init()` — call with NO ARGUMENTS. Never pass studio_url.
4. ALWAYS use `OpenAIChatFormatter()` — AtomChatModel normalises to OpenAI format via LiteLLM.
5. ReActAgent REQUIRES `formatter=OpenAIChatFormatter()` — never omit it.
6. Tool functions: implement as `async def` with docstring, register with `toolkit.register_tool_function(func)`.
7. Tools are called by the ReAct loop automatically — never call `agent.use_tool()` (does not exist).
8. After each /run, POST the result to ATOM_STUDIO_URL/api/agents/{{AGENT_ID}}/runs/ (fire-and-forget, swallow errors).
9. Include HITL (`request_human_decision`) where intent mentions escalation/approval.
10. Output ONLY the Python file content — no explanation, no markdown fences.

## Required server structure (follow this pattern exactly)

```python
import json, logging, os, time, uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import agentscope
import httpx
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import Msg
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit
from fastapi import FastAPI
from pydantic import BaseModel

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

AGENT_ID      = os.environ.get("ATOM_AGENT_ID", "")
STUDIO_URL    = os.environ.get("ATOM_STUDIO_URL", "http://atom-studio-api:3001")
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "")
KAFKA_TOPIC   = "atom.agent.logs"
_kafka_producer = None


async def _init_kafka():
    global _kafka_producer
    if not KAFKA_BROKERS:
        return
    try:
        from aiokafka import AIOKafkaProducer
        _kafka_producer = AIOKafkaProducer(
            bootstrap_servers=KAFKA_BROKERS,
            value_serializer=lambda v: json.dumps(v).encode(),
        )
        await _kafka_producer.start()
    except Exception as exc:
        log.warning("Kafka init failed: %s", exc)


async def _stop_kafka():
    if _kafka_producer:
        await _kafka_producer.stop()


async def _emit_log(message: str, source: str = "stdout"):
    if not _kafka_producer:
        return
    try:
        await _kafka_producer.send(KAFKA_TOPIC, {{
            "agent_id": AGENT_ID, "message": message, "source": source,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }})
    except Exception:
        pass


async def _record_run(run_id, user_msg, reply, steps, latency_ms):
    if not AGENT_ID or not STUDIO_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{{STUDIO_URL}}/api/agents/{{AGENT_ID}}/runs/",
                json={{"run_id": run_id, "user_msg": user_msg, "reply": reply,
                       "steps": steps, "latency_ms": latency_ms}})
    except Exception as exc:
        log.warning("record_run failed: %s", exc)


@asynccontextmanager
async def lifespan(app):
    await _init_kafka()
    yield
    await _stop_kafka()


agentscope.init()   # NO ARGUMENTS — never pass studio_url

app = FastAPI(lifespan=lifespan)

_toolkit = Toolkit()
# register tool functions here

_agent = ReActAgent(
    name=os.environ.get("ATOM_AGENT_NAME", "agent"),
    sys_prompt="<AGENT SYSTEM PROMPT>",
    model=AtomChatModel(model_name=os.environ.get("ATOM_MODEL", "{model_name}")),
    formatter=OpenAIChatFormatter(),
    toolkit=_toolkit,
    max_iters=10,
)


class RunRequest(BaseModel):
    message: str

class RunResponse(BaseModel):
    reply: str
    run_id: str


@app.get("/healthz")
async def healthz():
    return {{"status": "ok"}}


@app.post("/run", response_model=RunResponse)
async def run(req: RunRequest):
    run_id = str(uuid.uuid4())
    t0 = time.monotonic()
    await _emit_log(f"[request] {{req.message}}")

    response = await _agent(Msg(name="user", content=req.message, role="user"))
    blocks = response.get_content_blocks("text")
    reply = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
    latency_ms = int((time.monotonic() - t0) * 1000)

    await _emit_log(f"[reply] ({{latency_ms}}ms) {{reply}}")
    await _record_run(run_id, req.message, reply, [], latency_ms)
    return RunResponse(reply=reply, run_id=run_id)
```
"""
