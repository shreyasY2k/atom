"""
support-bot — HTTP agent server (production)

Wraps a ReActAgent in FastAPI for deployment behind the ATOM GATE.
Uses AtomChatModel so all LLM calls are routed through GATE → atom-llm.

Environment variables (injected by atom-runtime):
    ATOM_GATE_URL   — e.g. http://gate:8080
    ATOM_DOMAIN_ID  — domain UUID
    ATOM_AGENT_ID   — agent UUID
    ATOM_AGENT_JWT  — agent RS256 JWT

Endpoints:
    GET  /healthz  — liveness probe
    POST /run      — {"message": "..."} → {"reply": "...", "run_id": "...", "trace_id": "..."}
"""

import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv

load_dotenv()

import agentscope
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import Msg
from agentscope.model import AtomChatModel
from fastapi import FastAPI
from pydantic import BaseModel

from tools import build_toolkit

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

AGENT_ID   = os.environ.get("ATOM_AGENT_ID",   "")
STUDIO_URL = os.environ.get("ATOM_STUDIO_URL", "http://atom-studio-api:3001")
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "")
KAFKA_TOPIC   = "atom.agent.logs"

_kafka_producer = None


async def _init_kafka() -> None:
    global _kafka_producer
    if not KAFKA_BROKERS:
        log.info("KAFKA_BROKERS not set — log streaming disabled")
        return
    try:
        from aiokafka import AIOKafkaProducer  # noqa: PLC0415
        _kafka_producer = AIOKafkaProducer(
            bootstrap_servers=KAFKA_BROKERS,
            value_serializer=lambda v: json.dumps(v).encode(),
        )
        await _kafka_producer.start()
        log.info("Kafka producer connected → %s", KAFKA_BROKERS)
    except Exception as exc:
        log.warning("Kafka producer init failed: %s", exc)


async def _stop_kafka() -> None:
    if _kafka_producer:
        await _kafka_producer.stop()


async def _emit_log(message: str, source: str = "stdout") -> None:
    if not _kafka_producer:
        return
    try:
        await _kafka_producer.send(
            KAFKA_TOPIC,
            {
                "agent_id": AGENT_ID,
                "message": message,
                "source": source,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        )
    except Exception:
        pass


async def _record_run(
    run_id: str,
    trace_id: str | None,
    user_msg: str,
    reply: str,
    steps: list[dict],
    latency_ms: int,
) -> None:
    if not AGENT_ID or not STUDIO_URL:
        return
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{STUDIO_URL}/api/agents/{AGENT_ID}/runs/",
                json={
                    "run_id":     run_id,
                    "trace_id":   trace_id,
                    "user_msg":   user_msg,
                    "reply":      reply,
                    "steps":      steps,
                    "latency_ms": latency_ms,
                },
            )
    except Exception as exc:
        log.warning("Failed to record run to studio: %s", exc)


def _current_trace_id() -> str | None:
    try:
        from opentelemetry import trace as otel_trace  # noqa: PLC0415
        span = otel_trace.get_current_span()
        ctx  = span.get_span_context()
        if ctx and ctx.is_valid:
            return format(ctx.trace_id, "032x")
    except Exception:
        pass
    return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _init_kafka()
    yield
    await _stop_kafka()


app = FastAPI(title="support-bot", lifespan=lifespan)

agentscope.init()

_model = AtomChatModel(
    model_name=os.getenv("ATOM_MODEL_NAME", "gemini-2.5-flash"),
    stream=False,
)

_agent = ReActAgent(
    name="support-bot",
    model=_model,
    formatter=OpenAIChatFormatter(),
    toolkit=build_toolkit(),
    sys_prompt="You are a friendly customer support agent for an Indian fintech.\nHelp customers with account queries, transaction disputes, and product information.\nBe empathetic, concise, and always offer a clear next step.",
    max_iters=5,
)


class RunRequest(BaseModel):
    message: str


class RunResponse(BaseModel):
    reply: str
    run_id: str
    trace_id: str | None = None


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/run", response_model=RunResponse)
async def run(req: RunRequest):
    run_id  = str(uuid.uuid4())
    trace_id = _current_trace_id()
    t0 = time.monotonic()

    await _emit_log(f"[request] {req.message}")

    response = await _agent(Msg(name="user", content=req.message, role="user"))

    blocks = response.get_content_blocks("text")
    reply  = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
    latency_ms = int((time.monotonic() - t0) * 1000)

    await _emit_log(f"[reply] ({latency_ms}ms) {reply}")

    # Capture thinking / tool-call steps for Studio Conversations view
    steps: list[dict] = []
    try:
        for msg in _agent.memory.get_memory():
            if getattr(msg, "role", None) in ("assistant", "tool"):
                content = msg.content
                if isinstance(content, list):
                    for blk in content:
                        btype = blk.get("type", "")
                        if btype == "thinking":
                            steps.append({"type": "thinking", "text": blk.get("thinking", "")})
                        elif btype == "tool_use":
                            steps.append({"type": "tool_use", "name": blk.get("name", ""), "input": blk.get("input", {})})
                        elif btype == "tool_result":
                            steps.append({"type": "tool_result", "content": str(blk.get("content", ""))})
    except Exception:
        pass

    await _record_run(run_id, trace_id, req.message, reply, steps, latency_ms)

    return RunResponse(reply=reply, run_id=run_id, trace_id=trace_id)
