import logging
import os

logger = logging.getLogger(__name__)

SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")
ALWAYS_INCLUDED_SKILLS = ["atom-react-agent", "atom-gate-calls", "atom-audit"]


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
        f"- {a.get('name', a.get('id', ''))}: {a.get('id', '')}" for a in a2a_targets
    )

    return f"""You are generating agent.py for an ATOM agent.
Follow ALL instructions in the skill documents below exactly.

## Agent intent
{intent}

## Model to use
{model_name}

## MCP Tools available (call via use_tool())
{tool_schemas if tool_schemas else "None"}

## A2A targets (call via a2a_call())
{a2a_list if a2a_list else "None"}

## ATOM SDK Skills (FOLLOW THESE EXACTLY)
{skill_context}

Generate a complete, runnable agent.py.
Use only atom-sdk imports as specified in atom-react-agent skill.
Every tool call via use_tool(). Every A2A call via a2a_call().
Include HITL where appropriate for the intent.
Include memory recall before LLM calls if atom-memory is selected.
Output only the Python file content, no explanation.
"""
