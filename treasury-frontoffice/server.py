"""
treasury-frontoffice — HTTP agent server (production)

Wraps the ReActAgent in a FastAPI service so it can run as a container
behind the ATOM GATE. Uses atom-sdk (AtomChatModel) so all LLM calls
are automatically routed through GATE → atom-llm.

Environment variables (injected by atom-runtime):
    ATOM_GATE_URL   — e.g. http://gate:8080
    ATOM_DOMAIN_ID  — domain UUID
    ATOM_AGENT_ID   — agent UUID
    ATOM_AGENT_JWT  — agent RS256 JWT

Endpoints:
    GET  /healthz  — liveness probe
    POST /run      — {"message": "..."} → {"reply": "..."}
"""

import os

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

app = FastAPI(title="treasury-frontoffice")

agentscope.init()

_model = AtomChatModel(
    model_name=os.getenv("ATOM_MODEL_NAME", "gpt-4o"),
    stream=False,
)

_agent = ReActAgent(
    name="treasury-frontoffice",
    model=_model,
    formatter=OpenAIChatFormatter(),
    toolkit=build_toolkit(),
    sys_prompt=(
        "treasury agent  "
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
    response = await _agent(Msg(name="user", content=req.message, role="user"))
    blocks = response.get_content_blocks("text")
    reply = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
    return RunResponse(reply=reply)
