"""ATOM Example Agent — summarizer"""
import os
from agentscope.agents import ReActAgent
from agentscope.message import Msg

SYSTEM_PROMPT = """You are a document summarisation specialist. When given text, produce:
1. A 3-sentence executive summary
2. Key points as bullets (max 5)
3. Any action items or decisions required
Be concise and precise."""



def build_agent():
    return ReActAgent(
        name="summarizer",
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
