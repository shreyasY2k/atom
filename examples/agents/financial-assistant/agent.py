"""
financial-assistant — standalone dev mode

Run locally for testing:
    pip install agentscope openai python-dotenv
    ATOM_MODEL_NAME=gemini-2.5-flash python agent.py

In production, server.py wraps this behind FastAPI.
"""
import os
from dotenv import load_dotenv
load_dotenv()

import agentscope
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.message import Msg
from agentscope.model import AtomChatModel

from tools import build_toolkit

SYS_PROMPT = "You are a BFSI compliance assistant specialising in Indian regulatory frameworks. Always cite the relevant regulation."


def build_agent() -> ReActAgent:
    agentscope.init()
    model = AtomChatModel(
        model_name=os.getenv("ATOM_MODEL_NAME", "gemini-2.5-flash"),
        stream=False,
    )
    return ReActAgent(
        name="financial-assistant",
        model=model,
        formatter=OpenAIChatFormatter(),
        toolkit=build_toolkit(),
        sys_prompt=SYS_PROMPT,
        max_iters=5,
    )


def main() -> None:
    print("BFSI compliance and regulatory Q&A")
    print("Type 'exit' to quit.\n")
    agent = build_agent()
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("exit", "quit", "q"):
            break
        if not user_input:
            continue
        import asyncio
        response = asyncio.run(agent(Msg(name="user", content=user_input, role="user")))
        blocks = response.get_content_blocks("text")
        reply = " ".join(b.get("text", "") for b in blocks) if blocks else str(response.content)
        print(f"\nAgent: {reply}\n")


if __name__ == "__main__":
    main()
