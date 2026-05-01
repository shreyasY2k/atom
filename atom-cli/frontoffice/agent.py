"""
frontoffice — ReAct Agent
treasure agent

Run in dev mode:
    ATOM_MODE=dev python agent.py

Run in prod mode (after provisioning in atom-studio):
    ATOM_MODE=prod python agent.py
"""
import os
from dotenv import load_dotenv

load_dotenv()

import agentscope
from agentscope.agent import ReActAgent
from agentscope.message import Msg
from agentscope.memory import InMemoryMemory

from config import get_model_config
from tools import build_toolkit

if os.getenv("ATOM_MODE", "dev") == "prod":
    try:
        from agentscope.hitl import request_human_decision  # noqa: F401
    except ImportError:
        pass


def main() -> None:
    mode = os.getenv("ATOM_MODE", "dev")
    print("Starting frontoffice in " + mode.upper() + " mode")

    agentscope.init(model_configs=[get_model_config()])

    toolkit = build_toolkit()

    memory = InMemoryMemory()

    agent = ReActAgent(
        name="frontoffice",
        model_config_name="atom-default" if mode == "prod" else "dev-model",
        toolkit=toolkit,
        sys_prompt=(
            "treasure agent  "
            "Think step by step. Use tools when you need external information. "
            "Always cite which tool you used and what it returned."
        ),
        max_iters=10,
        memory=memory,
    )

    # HITL example — only works in prod mode when atom-studio is running.
    # Uncomment and guard with: if os.getenv("ATOM_MODE") == "prod":
    #
    #     decision = request_human_decision(
    #         agent_id=os.environ["ATOM_AGENT_ID"],
    #         prompt="Should the agent proceed with this action?",
    #         options=["approve", "reject"],
    #     )

    print("Agent ready. Type 'exit' to quit.\n")
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ("exit", "quit", "q"):
            break
        if not user_input:
            continue

        response = agent(Msg(name="user", content=user_input, role="user"))
        print(f"\nAgent: {response.content}\n")


if __name__ == "__main__":
    main()
