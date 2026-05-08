"""
Allowlist of upstream agentscope_skills capabilities.

When an agent spec declares agentscope_skills: [web_search], the builder
validates the name here and emits the correct import pattern in generated code.
"""

from __future__ import annotations

# skill_name → (import_statement, how_to_add_to_toolkit)
SKILL_REGISTRY: dict[str, dict] = {
    "web_search": {
        "import": "from agentscope_skills import web_search as _web_search_fn",
        "toolkit_add": "_as_tool_response(_web_search_fn)",
        "description": "Search the web for publicly available information (DuckDuckGo, no API key required).",
    },
}

ALLOWED_SKILLS = set(SKILL_REGISTRY.keys())


def validate_skills(names: list[str]) -> list[str]:
    """Return a list of error messages for any unknown skill names."""
    return [
        f"Unknown agentscope_skill {n!r}. Allowed: {sorted(ALLOWED_SKILLS)}"
        for n in names
        if n not in ALLOWED_SKILLS
    ]
