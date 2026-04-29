"""
frontoffice — HTTP server wrapper for production deployment.

Endpoints:
  GET  /healthz  — liveness probe
  POST /run      — {"message": "..."} → {"reply": "..."}

Logs every request/reply to atom.agent.logs Kafka topic (when KAFKA_BROKERS is set)
so they appear in atom-studio's Live Logs view.
"""
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

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

AGENT_ID = os.environ.get("ATOM_AGENT_ID", "")
KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "")
KAFKA_TOPIC = "atom.agent.logs"

_kafka_producer = None


async def _init_kafka() -> None:
    global _kafka_producer
    if not KAFKA_BROKERS:
        log.info("KAFKA_BROKERS not set — agent logs will not stream to Studio")
        return
    try:
        from aiokafka import AIOKafkaProducer
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
        await _kafka_producer.send(KAFKA_TOPIC, {
            "agent_id": AGENT_ID,
            "message": message,
            "source": source,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
    except Exception:
        pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _init_kafka()
    yield
    await _stop_kafka()


app = FastAPI(title="frontoffice", lifespan=lifespan)

agentscope.init()

_model = AtomChatModel(
    model_name=os.getenv("ATOM_MODEL_NAME", "gpt-4o"),
    stream=False,
)

_agent = ReActAgent(
    name="frontoffice",
    model=_model,
    formatter=OpenAIChatFormatter(),
    toolkit=build_toolkit(),
    sys_prompt=(
        "You are a helpful front-office assistant. "
        "Think step by step. Use tools when you need external information."
    ),
    max_iters=10,
)


class RunRequest(BaseModel):
    message: str


class RunResponse(BaseModel):
    reply: str


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}


@app.post("/run", response_model=RunResponse)
async def run(req: RunRequest):
    await _emit_log(f"[request] {req.message}")
    response = await _agent(Msg(name="user", content=req.message, role="user"))
    blocks = response.get_content_blocks("text")
    reply = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
    await _emit_log(f"[reply] {reply}")
    return RunResponse(reply=reply)
