import json
import logging
import os
from dataclasses import asdict, dataclass, field

import httpx

log = logging.getLogger(__name__)
SKILLS_DIR = os.environ.get("ATOM_SKILLS_DIR", "/atom-sdk/skills")

_BUILDER_TTL = 7200  # 2 hours


@dataclass
class BuilderState:
    session_id: str
    stage: str = "greeting"
    messages: list[dict] = field(default_factory=list)
    intent: str | None = None
    agent_name: str | None = None
    model: str | None = None
    tools: list[str] = field(default_factory=list)
    skills: list[str] = field(default_factory=list)
    a2a_targets: list[str] = field(default_factory=list)
    hitl_config: dict | None = None
    domain_id: str | None = None
    ci_target: str = "gitlab"
    agent_id: str | None = None
    gitlab_project_id: int | None = None
    gitlab_repo_url: str | None = None
    pipeline_id: int | None = None
    pipeline_url: str | None = None
    chat_url: str | None = None


# ── Redis persistence ──────────────────────────────────────────────────────────


async def save_state(redis, state: BuilderState) -> None:
    """Persist BuilderState to Redis as JSON with a 2-hour TTL."""
    key = f"builder_session:{state.session_id}"
    await redis.set(key, json.dumps(asdict(state)), ex=_BUILDER_TTL)


async def load_state(redis, session_id: str) -> BuilderState | None:
    """Load and deserialize BuilderState from Redis. Returns None if not found."""
    key = f"builder_session:{session_id}"
    raw = await redis.get(key)
    if raw is None:
        return None
    try:
        data = json.loads(raw)
        return BuilderState(**data)
    except Exception as exc:
        log.warning("builder: failed to deserialize session %s — %s", session_id, exc)
        return None


# ── Interviewer prompt ─────────────────────────────────────────────────────────


def build_interviewer_prompt(available_tools: list[dict], available_models: list[str]) -> str:
    """Return the system prompt for the builder interviewer LLM."""
    tools_list = "\n".join(
        f"  - {t.get('name', '')}: {t.get('description', '')}" for t in available_tools
    )
    models_list = "\n".join(f"  - {m}" for m in available_models)

    return f"""You are the ATOM Agent Builder, an AI assistant that helps users design and deploy intelligent agents on the ATOM platform.

Your goal is to interview the user, gather all necessary information, and build a complete agent specification through friendly conversation.

## Conversation stages
Progress through these stages in order:
1. **greeting** — Welcome the user. Ask what kind of agent they want to build.
2. **intent** — Clarify the agent's purpose and tasks. Ask follow-up questions to refine.
3. **model_select** — Suggest an appropriate model based on intent. Confirm with user.
4. **tools_select** — Suggest relevant tools from the available list. Confirm selection.
5. **skills_select** — Suggest relevant skills. Always include atom-gate-calls and atom-audit.
6. **a2a_config** — Ask if agent should coordinate with other agents (A2A). If yes, gather target names.
7. **hitl_config** — Ask if human-in-the-loop approval is needed for critical decisions.
8. **confirming** — Summarize the full spec and ask for confirmation.
9. **confirmed** — User has confirmed. Ready to deploy.

## Rules
- Ask ONE focused question at a time. Do not overwhelm the user with multiple questions.
- Be concise, friendly, and professional.
- If the user provides information proactively, capture it and skip related questions.
- When suggesting tools or models, explain briefly WHY you are suggesting them.
- After gathering all info, produce a clear summary before asking for confirmation.
- If the user says "looks good", "yes", "deploy", "confirm", or similar — advance to confirmed.
- Never invent tool names; only suggest from the available tools list below.
- Never invent model names; only suggest from the available models list below.

## Available tools
{tools_list if tools_list.strip() else "  (none configured)"}

## Available models
{models_list if models_list.strip() else "  (none configured)"}

## Response format
Always respond with a valid JSON object (no markdown, no backticks):
{{
  "message": "<your conversational reply to the user>",
  "updates": {{
    "intent": "<string or null — only set when you have a clear intent>",
    "agent_name": "<string or null — suggest a name when intent is clear>",
    "model": "<model_id or null>",
    "tools": ["<tool_name>", ...],
    "skills": ["<skill_name>", ...],
    "a2a_targets": ["<agent_name>", ...],
    "hitl_config": {{"enabled": true/false}} or null
  }},
  "stage": "<current stage name after this turn>"
}}

Only include fields in "updates" that changed in this turn. Omit unchanged fields entirely.
The "stage" field must always be present and reflect the new stage after this message.
"""


# ── Turn processing ────────────────────────────────────────────────────────────


async def _fetch_available_tools(atom_llm_url: str, litellm_master_key: str) -> list[dict]:
    """Fetch MCP tools from atom-llm. Returns empty list on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{atom_llm_url}/mcp/tools",
                headers={"Authorization": f"Bearer {litellm_master_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else data.get("tools", [])
    except Exception as exc:
        log.warning("builder: could not fetch tools from atom-llm — %s", exc)
        return []


async def _fetch_available_models(atom_llm_url: str, litellm_master_key: str) -> list[str]:
    """Fetch available model IDs from atom-llm. Returns sensible defaults on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{atom_llm_url}/models",
                headers={"Authorization": f"Bearer {litellm_master_key}"},
            )
            resp.raise_for_status()
            data = resp.json()
            models = data.get("data", data) if isinstance(data, dict) else data
            return [
                m.get("id", m.get("model_name", ""))
                for m in models
                if m.get("id") or m.get("model_name")
            ]
    except Exception as exc:
        log.warning("builder: could not fetch models from atom-llm — %s", exc)
        return [
            "gemini-2.5-flash",
            "gemini-3.1-pro-preview",
            "gemini-2.0-flash",
            "gpt-4o",
            "claude-sonnet-4",
        ]


def _apply_updates(state: BuilderState, updates: dict) -> None:
    """Apply the LLM-returned updates dict to the state in place."""
    if "intent" in updates and updates["intent"]:
        state.intent = updates["intent"]
    if "agent_name" in updates and updates["agent_name"]:
        state.agent_name = updates["agent_name"]
    if "model" in updates and updates["model"]:
        state.model = updates["model"]
    if "tools" in updates and isinstance(updates["tools"], list):
        state.tools = updates["tools"]
    if "skills" in updates and isinstance(updates["skills"], list):
        state.skills = updates["skills"]
    if "a2a_targets" in updates and isinstance(updates["a2a_targets"], list):
        state.a2a_targets = updates["a2a_targets"]
    if "hitl_config" in updates:
        state.hitl_config = updates["hitl_config"]


async def process_turn(
    state: BuilderState,
    user_message: str,
    atom_llm_url: str,
    litellm_master_key: str,
    studio_intent_model: str,
) -> tuple[str, dict, str]:
    """
    Process one conversation turn.

    Appends user_message to state.messages, calls LLM, parses JSON response,
    applies updates to state, and returns (ai_message, updates, new_stage).
    Falls back gracefully if LLM is unreachable.
    """
    # Append user message to history
    state.messages.append({"role": "user", "content": user_message})

    available_tools = await _fetch_available_tools(atom_llm_url, litellm_master_key)
    available_models = await _fetch_available_models(atom_llm_url, litellm_master_key)

    system_prompt = build_interviewer_prompt(available_tools, available_models)

    # Build messages for LLM (system + full history)
    llm_messages = [{"role": "system", "content": system_prompt}] + state.messages

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{atom_llm_url}/v1/chat/completions",
                headers={"Authorization": f"Bearer {litellm_master_key}"},
                json={
                    "model": studio_intent_model,
                    "messages": llm_messages,
                    "response_format": {"type": "json_object"},
                    "temperature": 0.7,
                },
            )
            resp.raise_for_status()
            raw_content = resp.json()["choices"][0]["message"]["content"]

        parsed = json.loads(raw_content)
        ai_message = parsed.get(
            "message",
            "I understand. Let me help you configure your agent.",
        )
        updates = parsed.get("updates", {})
        new_stage = parsed.get("stage", state.stage)

    except json.JSONDecodeError as exc:
        log.warning("builder: LLM returned non-JSON content — %s", exc)
        ai_message = (
            "I'm here to help you build your agent. Could you tell me more about what you need?"
        )
        updates = {}
        new_stage = state.stage
    except Exception as exc:
        log.warning("builder: LLM call failed — %s", exc)
        ai_message = (
            "Hello! I'm the ATOM Agent Builder. "
            "Tell me what kind of agent you'd like to create and I'll guide you through the setup."
        )
        updates = {}
        new_stage = "greeting"

    # Apply updates and advance stage
    _apply_updates(state, updates)
    state.stage = new_stage

    # Append assistant message to history
    state.messages.append({"role": "assistant", "content": ai_message})

    return ai_message, updates, new_stage
