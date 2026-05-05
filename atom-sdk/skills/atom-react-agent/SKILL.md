---
name: atom-react-agent
description: Generate a production FastAPI server (server.py) wrapping a ReActAgent with AtomChatModel. Always use OpenAIChatFormatter. agentscope.init() takes no arguments. The entrypoint is uvicorn not python.
---

# ATOM ReAct Agent — Production Server Pattern

ATOM agents are **FastAPI HTTP servers**, not scripts. The generated file must be a
runnable server with `/healthz` and `/POST /run` endpoints, not a CLI script.

## Required imports

```python
import agentscope
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter   # always use this — AtomChatModel speaks OpenAI format
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit
from agentscope.message import Msg
from fastapi import FastAPI
from pydantic import BaseModel
```

## `agentscope.init()` — NO ARGUMENTS

```python
agentscope.init()   # never pass studio_url — atom-studio connects differently
```

Passing `studio_url=` triggers a Socket.IO connection to AgentScope Studio.
Atom-studio does not have Socket.IO. Always call `init()` with no arguments.

## `ReActAgent.__init__` signature

```python
ReActAgent(
    name: str,
    sys_prompt: str,
    model: AtomChatModel,
    formatter: OpenAIChatFormatter,   # REQUIRED — always OpenAIChatFormatter
    toolkit: Toolkit | None = None,
    max_iters: int = 10,
)
```

## Always use `OpenAIChatFormatter`

`AtomChatModel` routes all calls through LiteLLM which normalises to OpenAI format.
Use `OpenAIChatFormatter()` for ALL models — Gemini, Claude, GPT, everything.

## Minimal production server.py

```python
import asyncio
import logging
import os
import time
import uuid

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

AGENT_ID   = os.environ.get("ATOM_AGENT_ID", "")
STUDIO_URL = os.environ.get("ATOM_STUDIO_URL", "http://atom-studio-api:3001")

app = FastAPI()
agentscope.init()   # no studio_url

_toolkit = Toolkit()
# toolkit.register_tool_function(my_tool_func)

_agent = ReActAgent(
    name=os.environ.get("ATOM_AGENT_NAME", "agent"),
    sys_prompt="You are a helpful assistant.",
    model=AtomChatModel(model_name=os.environ.get("ATOM_MODEL", "gemini-2.5-flash")),
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
    return {"status": "ok"}


@app.post("/run", response_model=RunResponse)
async def run(req: RunRequest):
    run_id = str(uuid.uuid4())
    t0 = time.monotonic()

    response = await _agent(Msg(name="user", content=req.message, role="user"))
    blocks = response.get_content_blocks("text")
    reply = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
    latency_ms = int((time.monotonic() - t0) * 1000)

    # Record run to atom-studio for Conversations view
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{STUDIO_URL}/api/agents/{AGENT_ID}/runs/",
                json={"run_id": run_id, "user_msg": req.message, "reply": reply,
                      "latency_ms": latency_ms, "steps": []},
            )
    except Exception as exc:
        log.warning("record_run failed: %s", exc)

    return RunResponse(reply=reply, run_id=run_id)
```

## Dockerfile CMD

```dockerfile
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
```

NOT `CMD ["python", "agent.py"]` — the entrypoint is `uvicorn`.

## What NOT to generate

- NEVER: `agentscope.init(studio_url=...)` — causes Socket.IO connection failure
- NEVER: `CMD ["python", "agent.py"]` — agents are uvicorn servers, not scripts
- NEVER: `GeminiChatFormatter`, `AnthropicChatFormatter` — always `OpenAIChatFormatter`
- NEVER: `from agentscope.agents import ...` — module is `agentscope.agent` (singular)
- NEVER: `from agentscope.models import ...` — module is `agentscope.model` (singular)
- NEVER: omit `formatter=` — `ReActAgent` raises `TypeError` without it
