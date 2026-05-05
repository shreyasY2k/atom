import logging
import os

logger = logging.getLogger(__name__)

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")
ALWAYS_INCLUDED_SKILLS = ["atom-react-agent", "atom-gate-calls", "atom-audit"]

# Template shown to LLM — NOT an f-string so ruff doesn't try to parse it
_AGENT_PY_TEMPLATE = """
import os
from agentscope.agent import ReActAgent
from agentscope.formatter import OpenAIChatFormatter
from agentscope.model import AtomChatModel
from agentscope.tool import Toolkit, ToolResponse
from agentscope.message import TextBlock


def _text(msg: str) -> ToolResponse:
    return ToolResponse(content=[TextBlock(type="text", text=msg)])


# ── Tool functions (implement one per MCP tool listed above) ──────────────────
# Every tool MUST return ToolResponse — use _text() for simple string results.

async def my_tool(param: str) -> ToolResponse:
    \"\"\"What this tool does. LLM reads this docstring to decide when to call it.

    Args:
        param: What param means.

    Returns:
        ToolResponse with the result.
    \"\"\"
    result = f"result for {param}"
    return _text(result)


# ── HITL (if escalation is needed) ───────────────────────────────────────────
from agentscope.hitl import request_human_decision

async def escalate(action: str, context: str) -> ToolResponse:
    \"\"\"Escalate action to a human reviewer.

    Args:
        action: What needs approval.
        context: Reasoning and data for the reviewer.

    Returns:
        ToolResponse with the reviewer decision.
    \"\"\"
    try:
        decision = request_human_decision(
            payload={"action": action, "context": context},
            timeout_s=300,
        )
        status = "APPROVED" if decision.get("approved") else "REJECTED"
        note = decision.get("note", "")
        return _text(f"Decision: {status}. {note}")
    except TimeoutError:
        return _text("Human decision timed out — action not taken.")


def build_agent() -> ReActAgent:
    toolkit = Toolkit()
    # toolkit.register_tool_function(my_tool)

    return ReActAgent(
        name=os.environ.get("ATOM_AGENT_NAME", "agent"),
        sys_prompt="<SYSTEM PROMPT>",
        model=AtomChatModel(model_name=os.environ.get("ATOM_MODEL", "MODEL_NAME")),
        formatter=OpenAIChatFormatter(),
        toolkit=toolkit,
        max_iters=10,
    )
"""


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

    header = (
        "Generate ONLY the file `agent.py` containing `build_agent() -> ReActAgent`.\n"
        "server.py (Kafka, FastAPI, /healthz, /run) is already fixed — do NOT generate it.\n\n"
        f"## Intent\n{intent}\n\n"
        f"## Model\n{model_name}\n\n"
        "## MCP Tools to implement (as async def returning ToolResponse)\n"
        f"{tool_schemas if tool_schemas else 'None'}\n\n"
        "## A2A targets (wrap as tool functions using A2AAgent)\n"
        f"{a2a_list if a2a_list else 'None'}\n\n"
    )

    rules = (
        "\n\n## Hard rules\n"
        "1. File contains ONLY `build_agent()` + helper tool functions above it\n"
        "2. ALL tool functions MUST return `ToolResponse(content=[TextBlock(type='text', text=...)])`\n"
        "   Use the `_text()` helper shown in the template\n"
        "3. NEVER return str/dict/None from a tool — causes `TypeError` at runtime\n"
        "4. For HITL: call `request_human_decision()` inside a tool, wrap result in `_text()`\n"
        "5. `formatter=OpenAIChatFormatter()` always — never any other formatter class\n"
        "6. `ReActAgent` in `agentscope.agent`, `AtomChatModel` in `agentscope.model` (singular)\n"
        "7. Do NOT call `agentscope.init()` — server.py handles that\n"
        "8. Replace MODEL_NAME in template with the actual model: " + model_name + "\n"
        "9. No markdown fences, no explanation — pure Python only\n"
    )

    skills_section = "\n## ATOM SDK Skills — READ AND FOLLOW EVERY RULE\n" + skill_context + "\n"

    template_section = "\n## Template to follow (adapt for the intent above)\n" + _AGENT_PY_TEMPLATE

    return header + skills_section + template_section + rules
