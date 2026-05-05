import logging
import os

logger = logging.getLogger(__name__)

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")
ALWAYS_INCLUDED_SKILLS = ["atom-react-agent", "atom-gate-calls", "atom-audit"]


def _formatter_for_model(model_name: str) -> str:
    """Return the correct formatter import and instantiation for the given model."""
    name = model_name.lower()
    if name.startswith("gemini"):
        return "from agentscope.formatter import GeminiChatFormatter", "GeminiChatFormatter()"
    if name.startswith("claude") or name.startswith("anthropic"):
        return "from agentscope.formatter import AnthropicChatFormatter", "AnthropicChatFormatter()"
    # Default: OpenAI-compatible (gpt-*, mistral, etc.)
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

    formatter_import, formatter_instance = _formatter_for_model(model_name)

    tool_schemas = "\n".join(f"- {t.get('name', '')}: {t.get('description', '')}" for t in tools)
    a2a_list = "\n".join(
        f"- {a.get('name', a.get('id', ''))}: agent_id={a.get('id', '')}" for a in a2a_targets
    )

    return f"""You are generating agent.py for an ATOM agent built with the atom-sdk (agentscope fork).
Follow ALL instructions in the skill documents below EXACTLY. They define the correct API.

## Agent intent
{intent}

## Model to use
{model_name}

## Formatter to use (REQUIRED — chosen based on model provider)
Import:  {formatter_import}
Use:     formatter={formatter_instance}

## MCP Tool functions to implement
{tool_schemas if tool_schemas else "None — no external tools needed"}

## A2A targets (remote agents to call)
{a2a_list if a2a_list else "None"}

## ATOM SDK Skills — READ AND FOLLOW EVERY RULE
{skill_context}

## Generation instructions
1. Generate a complete, runnable agent.py.
2. Use EXACTLY the imports shown in atom-react-agent skill — `agentscope.agent`, `agentscope.model`, `agentscope.tool`, `agentscope.memory`, `agentscope.formatter`, `agentscope.message`.
3. ReActAgent REQUIRES `formatter=` — never omit it.
4. For each MCP tool listed above, implement it as an `async def` function with a docstring, then register it with `toolkit.register_tool_function(func)`.
5. Tools are called by the ReAct loop automatically — never call `agent.use_tool()` (does not exist).
6. For A2A targets, use `A2AAgent` + `WellKnownAgentCardResolver` as shown in atom-a2a skill.
7. Include HITL (`request_human_decision`) where the intent requires human approval or escalation.
8. Include `InMemoryMemory` if atom-memory skill is selected.
9. Call `agentscope.init(studio_url=os.environ.get("ATOM_STUDIO_URL", "http://atom-studio-api:3001"))` at startup.
   ATOM_STUDIO_URL points to atom-studio-api which handles /trpc/registerRun.
   NEVER use ATOM_GATE_URL as studio_url — GATE does not have /trpc endpoints.
10. Output ONLY the Python file content — no explanation, no markdown fences.
"""
