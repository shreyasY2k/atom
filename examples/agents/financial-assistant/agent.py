"""
ATOM Example Agent — Financial Assistant

Answers BFSI compliance and regulatory questions.
Demonstrates: ReAct agent, Gemini, memory injection.
"""

import os
from agentscope.agents import ReActAgent
from agentscope.message import Msg

SYSTEM_PROMPT = """You are a BFSI (Banking, Financial Services and Insurance) compliance
assistant specialising in Indian regulatory frameworks. You help teams understand:
- RBI guidelines and circulars
- SEBI regulations
- DPDP Act (Digital Personal Data Protection)
- PCI-DSS requirements
- KYC/AML obligations

Always cite the relevant regulation or circular when answering.
If unsure, say so clearly — do not fabricate regulatory text."""


def build_agent():
    return ReActAgent(
        name="financial-assistant",
        model_config_name="atom-default",
        sys_prompt=SYSTEM_PROMPT,
        max_iters=3,
    )


def run(message: str, agent=None) -> str:
    if agent is None:
        agent = build_agent()
    msg = Msg(name="user", role="user", content=message)
    reply = agent(msg)
    return reply.content if reply else "No response"
