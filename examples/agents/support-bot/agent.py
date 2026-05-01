"""ATOM Example Agent — support-bot"""
import os
from agentscope.agents import ReActAgent
from agentscope.message import Msg



SYSTEM_PROMPT = """You are a friendly and professional customer support agent for an Indian fintech.
Help customers with:
- Account queries
- Transaction disputes
- Product information
- Escalation guidance
Be empathetic, concise, and always offer a next step. If you cannot resolve an issue, escalate to a human agent."""

def build_agent():
    return ReActAgent(
        name="support-bot",
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
