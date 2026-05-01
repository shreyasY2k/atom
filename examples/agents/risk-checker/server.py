"""
ATOM agent HTTP server.
POST /run {"message": "..."} → {"reply": "..."}
GET  /healthz              → {"status": "ok"}
"""
import json, logging, os, time, uuid
from contextlib import asynccontextmanager
import httpx
from dotenv import load_dotenv
load_dotenv()

import agentscope
from agentscope.model import AtomChatModel
from fastapi import FastAPI
from pydantic import BaseModel

from agent import build_agent, run as agent_run

log = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

GATE_URL   = os.environ.get("ATOM_GATE_URL",   "http://gate:8080")
AGENT_ID   = os.environ.get("ATOM_AGENT_ID",   "")
DOMAIN_ID  = os.environ.get("ATOM_DOMAIN_ID",  "")
AGENT_JWT  = os.environ.get("ATOM_AGENT_JWT",  "")
STUDIO_URL = os.environ.get("ATOM_STUDIO_URL", "http://atom-studio-api:3001")

_agent = None

@asynccontextmanager
async def lifespan(app):
    global _agent
    agentscope.init(
        model_configs=[{
            "config_name": "atom-default",
            "model_type":  "openai_chat",
            "model_name":  os.environ.get("ATOM_MODEL_NAME", "gemini-2.5-flash"),
            "api_key":     AGENT_JWT,
            "client_args": {
                "base_url": f"{GATE_URL}/domain/{DOMAIN_ID}/agent/{AGENT_ID}/v1/",
            },
        }],
        studio_url=STUDIO_URL,
    )
    _agent = build_agent()
    log.info("Agent ready")
    yield
    log.info("Agent shutting down")

app = FastAPI(lifespan=lifespan)

class RunRequest(BaseModel):
    message: str

@app.get("/healthz")
def health():
    return {"status": "ok"}

@app.post("/run")
async def run_endpoint(req: RunRequest):
    t0 = time.time()
    reply = agent_run(req.message, _agent)
    latency = int((time.time() - t0) * 1000)
    run_id = str(uuid.uuid4())

    # Record run in Studio Conversations view
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{STUDIO_URL}/api/agents/{AGENT_ID}/runs/",
                json={"run_id": run_id, "user_msg": req.message,
                      "reply": reply, "latency_ms": latency},
            )
    except Exception as e:
        log.warning("run record failed: %s", e)

    return {"reply": reply, "run_id": run_id, "latency_ms": latency}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
