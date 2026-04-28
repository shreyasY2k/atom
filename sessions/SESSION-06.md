# SESSION-06 — atom-sdk (agentscope Fork)

**Prerequisites:** SESSION-05 complete (atom-llm running)
**Goal:** Modify atom-sdk so every LLM call is structurally forced through GATE. No provider bypass possible. All agentscope framework features remain intact.
**Estimated time:** 1 day

---

## Context

`atom-sdk/` is already cloned from agentscope (SESSION-00). This session modifies it.

### Why this approach works

agentscope decouples model invocation from agents via `ModelWrapper`. Every agent
(`DialogAgent`, `ReActAgent`, `DictDialogAgent`, etc.) holds a reference to a wrapper
instance and calls it — the agent never touches HTTP directly.

agentscope's `OpenAIChatWrapper` already accepts a `client_args.base_url` parameter to
point at any OpenAI-compatible endpoint. This is how agentscope users run DeepSeek, DashScope,
Ollama, and others — not by writing new wrappers, but by setting `base_url`. atom-llm (LiteLLM)
exposes an OpenAI-compatible API at `/v1/chat/completions`. This means:

**We do not need to rewrite any agent logic, formatters, parsers, tool-calling, or streaming.
We just need one new wrapper that auto-configures `base_url` and `api_key` from ATOM env vars,
and we remove all other wrappers so that wrapper is the only possible path.**

### What stays unchanged

Everything except the models directory:
- All agent classes: `DialogAgent`, `ReActAgent`, `DictDialogAgent`, `UserAgent`, etc.
- All formatters: `CommonFormatter`, `OpenAIChatFormatter`, etc.
- All parsers and output validators
- Tool/function calling (OpenAI-format, works via LiteLLM)
- Streaming support (inherited from OpenAIChatWrapper)
- Multi-modal image support (inherited)
- MsgHub, pipelines, multi-agent orchestration
- Memory (RAG uses embedding wrapper — also redirected)
- HiClaw HITL hooks (added in this session)
- `agentscope.init()` flow (just uses different model_type)

---

## Files to understand first

Before making changes, read these files in `atom-sdk/src/agentscope/models/`:

| File | What it is |
|---|---|
| `model.py` | `ModelWrapperBase` (abstract base), `ModelResponse` dataclass — **keep unchanged** |
| `openai_model.py` | `OpenAIChatWrapper`, `OpenAIEmbeddingWrapper`, `OpenAIDALLEWrapper` — **keep as base classes** |
| `_model_utils.py` | `_verify_text_content_in_openai_delta_response` etc — **keep, shared utilities** |
| `_model_usage.py` | `ChatUsage`, token counting — **keep, used by all wrappers** |
| `anthropic_model.py` | `AnthropicChatWrapper` — **delete** |
| `zhipu_model.py` | `ZhipuAIWrapperBase`, `ZhipuAIChatWrapper`, etc — **delete** |
| `yi_model.py` | `YiChatWrapper` — **delete** |
| `dashscope_model.py` | DashScope wrappers — **delete** |
| `gemini_model.py` | `GeminiChatWrapper` — **delete** |
| `ollama_model.py` | `OllamaChatWrapper` — **delete** |
| `litellm_model.py` | `LiteLLMChatWrapper` — **delete** (confusing — we ARE litellm, via GATE) |
| `post_api_model.py` | Generic HTTP POST wrapper — **delete** |
| Any other `*_model.py` | Delete — only OpenAI-compatible path survives |
| `__init__.py` | **Rewrite** — export only ATOM wrappers |

---

## Tasks

### 1. Read the OpenAIChatWrapper constructor signature

In `openai_model.py`, find the `__init__` of `OpenAIChatWrapper`. You will see it accepts:
- `model_name: str`
- `api_key: Optional[str]`
- `client_args: Optional[dict]` — this is where `base_url` lives
- `generate_args: Optional[dict]`
- `stream: bool`

`AtomChatWrapper` will call `super().__init__()` with `base_url` pre-set to GATE and
`api_key` set to the agent JWT. Developers never pass these — they come from env vars.

---

### 2. Create `atom-sdk/src/agentscope/models/atom_model.py`

```python
"""
atom_model.py — ATOM model wrappers for agentscope.

All LLM calls are routed through GATE using the agent's JWT.
Developers configure model_name only; endpoint and auth are injected from env.
"""
import os
from typing import Optional, Union, Generator, Sequence

from .openai_model import OpenAIChatWrapper, OpenAIEmbeddingWrapper
from .model import ModelResponse
from ..message import Msg


def _gate_base_url() -> str:
    """Build the GATE endpoint URL for this agent's LLM path."""
    gate_url = os.environ["ATOM_GATE_URL"].rstrip("/")
    domain_id = os.environ["ATOM_DOMAIN_ID"]
    agent_id = os.environ["ATOM_AGENT_ID"]
    return f"{gate_url}/domain/{domain_id}/agent/{agent_id}/v1"


def _agent_jwt() -> str:
    jwt = os.environ.get("ATOM_AGENT_JWT")
    if not jwt:
        raise EnvironmentError(
            "ATOM_AGENT_JWT is not set. "
            "This env var is injected by atom-runtime when the agent pod starts. "
            "For local dev, set it in .env from the token generated in atom-studio."
        )
    return jwt


class AtomChatWrapper(OpenAIChatWrapper):
    """
    Chat wrapper that routes all LLM calls through GATE → atom-llm.

    This is the ONLY chat wrapper available in atom-sdk.
    The base_url and api_key are injected from ATOM env vars — they cannot
    be overridden via model config. This is intentional: no agent can bypass
    GATE by specifying a different endpoint.

    Config format in atom_agent.yaml:
        model_configs:
          - config_name: atom-default
            model_type: atom_chat
            model_name: gpt-4o          # forwarded to atom-llm
            stream: false               # optional
            generate_args:              # optional LiteLLM pass-through args
              temperature: 0.7

    model_name is passed to atom-llm which resolves it against the agent's
    allowed_models list (enforced by atom-llm virtual key).
    """

    model_type: str = "atom_chat"

    def __init__(
        self,
        model_name: str,
        config_name: Optional[str] = None,
        stream: bool = False,
        generate_args: Optional[dict] = None,
        **kwargs,
    ) -> None:
        # Explicitly do NOT accept api_key or base_url from config.
        # They are always sourced from env vars to prevent bypass.
        super().__init__(
            model_name=model_name,
            config_name=config_name,
            api_key=_agent_jwt(),
            client_args={"base_url": _gate_base_url()},
            generate_args=generate_args or {},
            stream=stream,
        )


class AtomEmbeddingWrapper(OpenAIEmbeddingWrapper):
    """
    Embedding wrapper that routes through GATE → atom-llm.

    Used by agentscope's RAG pipeline and atom-memory for vector storage.

    Config format:
        model_configs:
          - config_name: atom-embedding
            model_type: atom_embedding
            model_name: text-embedding-3-small
    """

    model_type: str = "atom_embedding"

    def __init__(
        self,
        model_name: str,
        config_name: Optional[str] = None,
        generate_args: Optional[dict] = None,
        **kwargs,
    ) -> None:
        super().__init__(
            model_name=model_name,
            config_name=config_name,
            api_key=_agent_jwt(),
            client_args={"base_url": _gate_base_url()},
            generate_args=generate_args or {},
        )
```

---

### 3. Delete all other provider model files

```bash
cd atom-sdk/src/agentscope/models/

# These all go. Document each in UPSTREAM_DIFF.md before deleting.
rm anthropic_model.py
rm zhipu_model.py
rm yi_model.py
rm litellm_model.py
rm post_api_model.py

# Check for and delete any of these if present:
# dashscope_model.py, gemini_model.py, ollama_model.py,
# spark_model.py, qwen_model.py, moonshot_model.py, mistral_model.py
ls *_model.py | grep -v "^model.py$\|^openai_model.py$\|^atom_model.py$\|^_model"
# Delete everything listed above
```

Document every deleted file in `atom-sdk/UPSTREAM_DIFF.md`:
```
## Deleted model wrappers (SESSION-06)
- anthropic_model.py — AnthropicChatWrapper. Removed: direct provider bypass.
- zhipu_model.py     — ZhipuAI wrappers. Removed: direct provider bypass.
- litellm_model.py   — LiteLLMChatWrapper. Removed: confusing duplicate (ATOM IS litellm via GATE).
... etc
```

---

### 4. Rewrite `__init__.py` in models/

```python
"""
agentscope/models/__init__.py

In atom-sdk, only AtomChatWrapper and AtomEmbeddingWrapper are exported.
All other provider wrappers have been removed — LLM calls must flow through GATE.
"""
from .model import ModelWrapperBase, ModelResponse
from .atom_model import AtomChatWrapper, AtomEmbeddingWrapper
from ._model_usage import ChatUsage

__all__ = [
    "ModelWrapperBase",
    "ModelResponse",
    "AtomChatWrapper",
    "AtomEmbeddingWrapper",
    "ChatUsage",
]
```

---

### 5. Add HITL hooks

Create `atom-sdk/src/agentscope/hitl/__init__.py`:

```python
"""HITL integration — pause agent execution for human decision."""
from .hiclaw_hooks import request_human_decision

__all__ = ["request_human_decision"]
```

Create `atom-sdk/src/agentscope/hitl/hiclaw_hooks.py`:

```python
"""
hiclaw_hooks.py

Allows agents to pause and request a human decision via atom-studio HITL queue.
The agent blocks (polling) until approved/rejected or timeout is reached.

Usage:
    from agentscope.hitl import request_human_decision

    decision = request_human_decision(
        payload={"action": "approve_loan", "amount": 50000, "customer_id": "4821"},
        timeout_s=300,
    )
    if decision["approved"]:
        proceed_with_loan()
    else:
        reject_with_reason(decision["note"])
"""
import os
import time
import httpx
from typing import Any


def request_human_decision(
    payload: dict[str, Any],
    timeout_s: int = 300,
    poll_interval_s: int = 5,
) -> dict[str, Any]:
    """
    Submit a HITL decision request to atom-studio and block until resolved.

    Args:
        payload:  Arbitrary dict describing the decision needed. Shown to
                  the human reviewer in the studio HITL queue.
        timeout_s: Seconds to wait before raising TimeoutError.
                   The agent's hitl_fallback setting determines what happens
                   after timeout (ABORT | CONTINUE | ESCALATE).
        poll_interval_s: How often to poll for a decision (default 5s).

    Returns:
        { "approved": bool, "note": str, "decided_by": str, "decided_at": str }

    Raises:
        TimeoutError: If no decision is made within timeout_s.
        EnvironmentError: If ATOM env vars are not set.
    """
    gate_url = os.environ["ATOM_GATE_URL"].rstrip("/")
    domain_id = os.environ["ATOM_DOMAIN_ID"]
    agent_id = os.environ["ATOM_AGENT_ID"]
    jwt = os.environ["ATOM_AGENT_JWT"]

    hitl_url = f"{gate_url}/domain/{domain_id}/agent/{agent_id}/hitl/request"
    status_url_template = (
        f"{gate_url}/domain/{domain_id}/agent/{agent_id}/hitl/{{hitl_id}}/status"
    )

    headers = {
        "Authorization": f"Bearer {jwt}",
        "Content-Type": "application/json",
    }

    # Submit the HITL request
    with httpx.Client(timeout=30) as client:
        resp = client.post(
            hitl_url,
            json={"payload": payload, "timeout_s": timeout_s},
            headers=headers,
        )
        resp.raise_for_status()
        hitl_id = resp.json()["hitl_id"]

    # Poll for decision
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        time.sleep(poll_interval_s)
        with httpx.Client(timeout=10) as client:
            resp = client.get(
                status_url_template.format(hitl_id=hitl_id),
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        if data["status"] in ("approved", "rejected"):
            return {
                "approved": data["status"] == "approved",
                "note": data.get("decision_note", ""),
                "decided_by": data.get("decided_by", ""),
                "decided_at": data.get("decided_at", ""),
            }
        # Still pending — keep polling

    raise TimeoutError(
        f"HITL decision timed out after {timeout_s}s (hitl_id={hitl_id}). "
        f"The agent's hitl_fallback setting determines the next action."
    )
```

---

### 6. Update the top-level agentscope `__init__.py`

agentscope's root `__init__.py` calls `agentscope.init()`. Find it and verify:
- The `model_configs` argument works with `model_type: "atom_chat"` (it should — it uses `model_type` to look up the registered wrapper class)
- Remove any startup code that reads `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. from env and prints warnings about them being unset

---

### 7. Write an example agent

Create `atom-sdk/examples/hello_atom.py`:

```python
"""
Minimal working agent using atom-sdk.

Pre-requisites:
  export ATOM_GATE_URL=http://localhost:8080
  export ATOM_AGENT_JWT=<token from atom-studio>
  export ATOM_AGENT_ID=<agent uuid>
  export ATOM_DOMAIN_ID=<domain uuid>

Run: python examples/hello_atom.py
"""
import agentscope
from agentscope.agents import DialogAgent, UserAgent

agentscope.init(
    model_configs=[
        {
            "config_name": "atom-default",
            "model_type": "atom_chat",
            "model_name": "gpt-4o",
        }
    ]
)

agent = DialogAgent(
    name="assistant",
    model_config_name="atom-default",
    sys_prompt="You are a helpful BFSI assistant.",
)
user = UserAgent(name="user")

msg = None
while True:
    msg = agent(msg)
    msg = user(msg)
    if msg.content.strip().lower() == "exit":
        break
```

---

### 8. Verify all agentscope built-in agent types still work

Run the unit test suite that came with the upstream clone:

```bash
cd atom-sdk
pip install -e ".[dev]"

# These should all pass — they test agent logic, NOT model API calls
# (built-in tests mock the model layer)
pytest tests/test_agents/ -v
pytest tests/test_parsers/ -v
pytest tests/test_pipeline/ -v
pytest tests/test_message/ -v

# This one should fail if any direct provider imports remain
python -c "
import agentscope.models as m
assert not hasattr(m, 'OpenAIChatWrapper'), 'OpenAIChatWrapper should not be exported'
assert not hasattr(m, 'AnthropicChatWrapper'), 'Anthropic not removed!'
assert hasattr(m, 'AtomChatWrapper'), 'AtomChatWrapper missing'
assert hasattr(m, 'AtomEmbeddingWrapper'), 'AtomEmbeddingWrapper missing'
print('Model wrapper audit: PASS')
"
```

---

## Technologies

| Technology | Rationale |
|---|---|
| `OpenAIChatWrapper` (as base) | All agentscope agent types, formatters, tool-calling, streaming already use the OpenAI wire format. Extending it means zero framework changes. |
| `client_args.base_url` | agentscope's own pattern for OpenAI-compatible endpoints. Proven with DashScope, DeepSeek, Ollama in upstream. |
| atom-llm as the endpoint | atom-llm (LiteLLM fork) exposes `/v1/chat/completions` — fully OpenAI-compatible. |
| Agent JWT as `api_key` | The `openai` Python client sends `api_key` as `Authorization: Bearer {key}`. GATE validates this as the agent JWT. |
| `httpx` for HITL | Already a dependency of agentscope. |

---

## What developers write in atom_agent.yaml

```yaml
model_configs:
  - config_name: atom-default
    model_type: atom_chat         # the ONLY valid type
    model_name: gpt-4o            # forwarded to atom-llm; must be in agent's allowed_models
    stream: false
    generate_args:
      temperature: 0.7

  - config_name: atom-embedding
    model_type: atom_embedding
    model_name: text-embedding-3-small
```

`api_key` and `base_url` are intentionally absent from the config. Any attempt to set
them is silently ignored — the wrapper ignores those kwargs in its `__init__`. This is
the architectural control: there is no config knob to bypass GATE.

---

## Acceptance Criteria

- [ ] `python -c "from agentscope.models import AtomChatWrapper, AtomEmbeddingWrapper; print('ok')"` works
- [ ] `python -c "from agentscope.models import AnthropicChatWrapper"` raises `ImportError`
- [ ] `python -c "from agentscope.models import OpenAIChatWrapper"` raises `ImportError` (not exported)
- [ ] `AtomChatWrapper.__init__` reads `ATOM_GATE_URL`, `ATOM_DOMAIN_ID`, `ATOM_AGENT_ID`, `ATOM_AGENT_JWT` from env — fails loudly if any are missing
- [ ] `AtomChatWrapper.__init__` does NOT accept `api_key` or `base_url` as arguments
- [ ] `examples/hello_atom.py` runs against the live GATE + atom-llm stack and returns a response
- [ ] `agentscope.agents.ReActAgent` and `DialogAgent` work with `model_type: atom_chat`
- [ ] `request_human_decision()` submits to studio HITL queue and polls for decision
- [ ] `pytest tests/test_agents/ tests/test_parsers/ tests/test_pipeline/ -v` — all pass
- [ ] `atom-sdk/UPSTREAM_DIFF.md` documents every deleted file

---

## Claude Code Starter Prompt

```
You are implementing SESSION-06 of ATOM — modifying atom-sdk (agentscope fork) so
all LLM calls route through GATE. atom-sdk/ is already cloned from agentscope.

Context:
- atom-llm (LiteLLM fork) exposes an OpenAI-compatible API
- agentscope's OpenAIChatWrapper already supports client_args.base_url for
  custom endpoints — this is the standard agentscope pattern for OpenAI-compatible APIs
- We extend OpenAIChatWrapper rather than replace it to keep all agent/formatter
  functionality intact

Tasks:

1. Read atom-sdk/src/agentscope/models/openai_model.py — understand OpenAIChatWrapper.__init__
   signature (especially client_args and api_key parameters)

2. Create atom-sdk/src/agentscope/models/atom_model.py with:
   - AtomChatWrapper(OpenAIChatWrapper):
     - model_type = "atom_chat"
     - __init__ reads ATOM_GATE_URL, ATOM_DOMAIN_ID, ATOM_AGENT_ID, ATOM_AGENT_JWT from env
     - Builds base_url = "{ATOM_GATE_URL}/domain/{ATOM_DOMAIN_ID}/agent/{ATOM_AGENT_ID}/v1"
     - Calls super().__init__(api_key=jwt, client_args={"base_url": base_url}, ...)
     - Does NOT accept api_key or base_url in its own __init__ signature
   - AtomEmbeddingWrapper(OpenAIEmbeddingWrapper): same pattern, model_type = "atom_embedding"

3. Delete all non-OpenAI provider model files (anthropic, zhipu, yi, litellm, post_api,
   dashscope, gemini, ollama, and any others). Keep: model.py, openai_model.py,
   atom_model.py, _model_utils.py, _model_usage.py

4. Rewrite models/__init__.py to export only:
   ModelWrapperBase, ModelResponse, AtomChatWrapper, AtomEmbeddingWrapper, ChatUsage

5. Create atom-sdk/src/agentscope/hitl/__init__.py and hiclaw_hooks.py
   with request_human_decision() function that:
   - POSTs to {ATOM_GATE_URL}/domain/{did}/agent/{aid}/hitl/request
   - Polls every 5s for status
   - Returns {approved, note, decided_by, decided_at} on resolution
   - Raises TimeoutError after timeout_s seconds

6. Create atom-sdk/examples/hello_atom.py minimal working example

7. Run: pytest tests/test_agents/ tests/test_parsers/ -v (should all pass)

8. Verify: python -c "from agentscope.models import AnthropicChatWrapper" raises ImportError
   python -c "from agentscope.models import AtomChatWrapper; print('ok')"

9. Document all deleted files in atom-sdk/UPSTREAM_DIFF.md

10. git add atom-sdk/ && git commit -m "feat(atom-sdk): route all LLM calls through GATE via AtomChatWrapper"
```
