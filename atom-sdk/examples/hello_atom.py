"""
hello_atom.py — Minimal working agent using atom-sdk.

Prerequisites:
    export ATOM_GATE_URL=http://localhost:8080
    export ATOM_AGENT_JWT=<token from atom-studio>
    export ATOM_AGENT_ID=<agent uuid>
    export ATOM_DOMAIN_ID=<domain uuid>

Run:
    python examples/hello_atom.py

How it works:
    AtomChatModel reads the ATOM env vars above and configures the
    OpenAI-compatible client to call GATE → atom-llm.
    No API keys or base_url appear in user code — they cannot be overridden.
"""

import asyncio  # noqa: F401

import agentscope
from agentscope.agent import AgentBase
from agentscope.message import Msg
from agentscope.model import AtomChatModel


agentscope.init()

# Instantiate the model — credentials come from env vars, not config.
model = AtomChatModel(
    model_name="gpt-4o",
    stream=False,
    generate_kwargs={"temperature": 0.7},
)


class HelloAgent(AgentBase):
    """A minimal agent that replies to every message."""

    def __init__(self, name: str, model: AtomChatModel) -> None:
        super().__init__(name=name)
        self.model = model

    async def reply(self, x: Msg | None = None) -> Msg:
        msgs = [
            {"role": "system", "content": "You are a helpful BFSI assistant."},
        ]
        if x is not None:
            msgs.append({"role": "user", "content": x.content})

        response = await self.model(messages=msgs)
        return Msg(name=self.name, content=response.text, role="assistant")


async def main() -> None:
    agent = HelloAgent(name="assistant", model=model)

    print("Type 'exit' to quit.\n")
    user_input = input("You: ")
    while user_input.strip().lower() != "exit":
        user_msg = Msg(name="user", content=user_input, role="user")
        reply = await agent.reply(user_msg)
        print(f"Assistant: {reply.content}\n")
        user_input = input("You: ")


if __name__ == "__main__":
    asyncio.run(main())
