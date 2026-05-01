"""ATOM Example Agent — risk-checker"""
import os
from agentscope.agents import ReActAgent
from agentscope.message import Msg


SYSTEM_PROMPT = """You are a financial risk assessment assistant.
When given a transaction, product, or scenario, assess:
- Risk level (Low / Medium / High / Critical)
- Risk category (Credit, Market, Operational, Liquidity, Compliance)
- Rationale (2-3 sentences)
- Recommended controls
Always structure your output with these four sections."""


def build_agent():
    return ReActAgent(
        name="risk-checker",
        model_config_name="atom-default",
        sys_prompt=SYSTEM_PROMPT,
        max_iters=3,
    )

def run(message: str, agent=None) -> str:
    if agent is None:
        agent = build_agent()
    from agentscope.message import Msg
    reply = agent(Msg(name="user", role="user", content=message))
    return reply.content if reply else "No response"
