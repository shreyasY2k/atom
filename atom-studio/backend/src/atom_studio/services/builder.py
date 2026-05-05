import logging
import os

logger = logging.getLogger(__name__)

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")
ALWAYS_INCLUDED_SKILLS = ["atom-react-agent", "atom-gate-calls", "atom-audit"]


def _formatter_for_model(_model_name: str) -> tuple[str, str]:
    """Always OpenAIChatFormatter — AtomChatModel normalises to OpenAI format via LiteLLM."""
    return "from agentscope.formatter import OpenAIChatFormatter", "OpenAIChatFormatter()"


def build_agent_py_prompt(
    intent: str,
    model_name: str,
    tools: list[dict],
    skills: list[str],
    a2a_targets: list[dict],
) -> str:
    all_skills = ALWAYS_INCLUDED_SKILLS + [s for s in skills if s not in ALWAYS_INCLUDED_SKILLS]
    skill_context = ""
    for skill_name in all_skills:
        skill_path = os.path.join(SKILLS_DIR, skill_name, "SKILL.md")
        if not os.path.exists(skill_path):
            logger.warning("builder: skill %s not found at %s", skill_name, skill_path)
            continue
        with open(skill_path) as f:
            skill_context += f"\n\n---\n{f.read()}"

    tool_schemas = "\n".join(f"- {t.get('name', '')}: {t.get('description', '')}" for t in tools)
    a2a_list = "\n".join(
        f"- {a.get('name', a.get('id', ''))}: agent_id={a.get('id', '')}" for a in a2a_targets
    )

    return f"""Generate ONLY the file `agent.py` containing a single function `build_agent()` that returns a configured ReActAgent.

The surrounding server (FastAPI, Kafka logging, /healthz, /run endpoints) is already handled by a fixed server.py.
You only need to provide the agent-specific logic.

## Agent intent
{intent}

## Model
{model_name}

## MCP Tools to register (implement as async def functions, register with toolkit.register_tool_function)
{tool_schemas if tool_schemas else "None"}

## A2A targets (implement as tool functions using A2AAgent + WellKnownAgentCardResolver)
{a2a_list if a2a_list else "None"}

## ATOM SDK Skills — READ AND FOLLOW EVERY RULE
{skill_context}

## Required output — agent.py with build_agent()

```python
import os
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit
# add other imports as needed

def build_agent() -> ReActAgent:
    toolkit = Toolkit()

    # ── Tool functions ─────────────────────────────────────────────────────────
    # For each tool: implement async def, then toolkit.register_tool_function(func)
    # Tools are called by the ReAct loop automatically — never call agent.use_tool()

    # ── Build agent ────────────────────────────────────────────────────────────
    return ReActAgent(
        name=os.environ.get("ATOM_AGENT_NAME", "agent"),
        sys_prompt="<WRITE APPROPRIATE SYSTEM PROMPT FOR THE INTENT>",
        model=AtomChatModel(model_name=os.environ.get("ATOM_MODEL", "{model_name}")),
        formatter=OpenAIChatFormatter(),   # ALWAYS this — never GeminiChatFormatter
        toolkit=toolkit,
        max_iters=10,
    )
```

## Hard rules
1. Output ONLY agent.py content — no server.py, no FastAPI, no Kafka, no /run, no /healthz
2. The file must contain exactly one function: `build_agent() -> ReActAgent`
3. `formatter=OpenAIChatFormatter()` — always, never any other formatter class
4. `ReActAgent` is in `agentscope.agent`, `AtomChatModel` in `agentscope.model` (singular modules)
5. Do NOT call `agentscope.init()` in agent.py — server.py handles that
6. No markdown fences, no explanation — pure Python only
"""
