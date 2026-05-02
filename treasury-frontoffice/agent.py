"""
treasury-frontoffice — ReAct Agent

Routes all LLM calls through GATE. Each conversation appears in
atom-studio → Agents → Conversations tab automatically.

Setup:
    bash setup-dev.sh
    source .venv/bin/activate
    # Fill in .env (ATOM_GATE_URL, ATOM_DOMAIN_ID, ATOM_AGENT_ID, ATOM_AGENT_JWT)

Run:
    python agent.py
"""
import asyncio
import os
import time
import uuid
from dotenv import load_dotenv

load_dotenv()

import agentscope
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.memory import InMemoryMemory
from agentscope.message import Msg
from agentscope.model import AtomChatModel

from tools import build_toolkit


STUDIO_URL = os.environ.get("ATOM_STUDIO_URL", "http://localhost:3001")
AGENT_ID   = os.environ.get("ATOM_AGENT_ID", "")


def _extract_reply(msg) -> str:
    """Extract plain text from a Msg (content may be str or list of blocks)."""
    content = msg.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"]
        return " ".join(parts).strip() or str(content)
    return str(content)


async def _record_run(run_id: str, user_msg: str, reply: str, latency_ms: int) -> None:
    """Send the completed run to atom-studio so it appears in Conversations."""
    if not AGENT_ID:
        return
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(
                f"{STUDIO_URL}/api/agents/{AGENT_ID}/runs/",
                json={"run_id": run_id, "user_msg": user_msg,
                      "reply": reply, "latency_ms": latency_ms},
            )
    except Exception:
        pass  # Studio recording is best-effort; never block the agent


def main() -> None:
    # agentscope.init() sets up logging only.
    # atom-studio uses REST for run recording (not Socket.IO), so no studio_url here.
    agentscope.init()

    model = AtomChatModel(
        model_name=os.environ.get("ATOM_MODEL_NAME", "gemini/gemini-2.5-flash"),
        stream=False,
    )

    agent = ReActAgent(
        name="treasury-frontoffice",
        model=model,
        formatter=OpenAIChatFormatter(),
        toolkit=build_toolkit(),
        sys_prompt=(
            "treasury agent  "
            "Think step by step. Use tools when you need external information."
        ),
        max_iters=5,
        memory=InMemoryMemory(),
    )

    print("treasury-frontoffice agent ready. Conversations → atom-studio Conversations tab.\nType 'exit' to quit.\n")
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("exit", "quit", "q"):
            break
        if not user_input:
            continue

        run_id = str(uuid.uuid4())
        t0 = time.monotonic()
        response = asyncio.run(
            agent(Msg(name="user", content=user_input, role="user"))
        )
        latency_ms = int((time.monotonic() - t0) * 1000)
        reply = _extract_reply(response)

        asyncio.run(_record_run(run_id, user_input, reply, latency_ms))
        print(f"\nAgent: {reply}\n")


if __name__ == "__main__":
    main()
