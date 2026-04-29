"""
frontoffice — HTTP server wrapper for production deployment.

Wraps the ReAct agent in a FastAPI service so it can run as a container
behind the ATOM GATE. Listens on port 8080.

Endpoints:
  GET  /healthz      — liveness probe (GATE + atom-runtime poll this)
  POST /run          — run the agent on a single message; returns the response
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

app = FastAPI(title="frontoffice")

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
    response = await _agent(Msg(name="user", content=req.message, role="user"))
    # Extract text blocks from the response content
    blocks = response.get_content_blocks("text")
    reply = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
    return RunResponse(reply=reply)
