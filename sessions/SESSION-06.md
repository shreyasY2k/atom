# SESSION-06 — atom-sdk (agentscope Fork)

**Prerequisites:** SESSION-05 complete  
**Goal:** Fork agentscope into atom-sdk — remove all AI providers, implement AtomModelWrapper, add HITL hooks.  
**Estimated time:** 1 day

---

## Tasks

1. **Identify and remove provider wrappers** in `atom-sdk/`  
   agentscope has model wrappers for: OpenAI, Anthropic, Gemini, ZhipuAI, DashScope, etc.
   Remove all of them from `src/agentscope/models/`.
   Document in `atom-sdk/UPSTREAM_DIFF.md`.
   Keep: base `ModelWrapperBase` class and `ModelResponse` dataclass.

2. **Implement `AtomModelWrapper`** (`atom-sdk/src/agentscope/models/atom_model.py`)
   ```python
   class AtomModelWrapper(ModelWrapperBase):
       def __init__(self, config_name: str, agent_jwt: str, gate_url: str, model_name: str):
           ...
       
       def __call__(self, messages: list[dict], **kwargs) -> ModelResponse:
           # POST to {gate_url}/domain/{domain_id}/agent/{agent_id}/v1/chat/completions
           # Authorization: Bearer {agent_jwt}
           # X-ATOM-Agent-ID: {agent_id}
           ...
   ```
   The agent_jwt and gate_url come from environment variables `ATOM_AGENT_JWT` and `ATOM_GATE_URL`
   (set at pod creation time by atom-runtime).

3. **Update model config schema**  
   In `atom-sdk/src/agentscope/models/__init__.py`, register only `AtomModelWrapper`.
   Config format:
   ```yaml
   model_configs:
     - config_name: atom-default
       model_type: atom
       model_name: gpt-4o  # forwarded to atom-llm
   ```

4. **HITL hooks** (`atom-sdk/src/agentscope/hitl/`)
   ```python
   # atom-sdk/src/agentscope/hitl/hiclaw_hooks.py
   def request_human_decision(payload: dict, timeout_s: int = 300) -> dict:
       """
       POST to atom-studio HITL API via GATE.
       Polls for decision or raises TimeoutError.
       Returns: { approved: bool, note: str }
       """
   ```
   Wrap HiClaw's existing mechanism to call atom-studio's HITL endpoint rather than a
   local HiClaw server.

5. **Example agent** (`atom-sdk/examples/hello_atom_agent.py`)
   A minimal working agent that:
   - Reads `ATOM_AGENT_JWT` and `ATOM_GATE_URL` from environment.
   - Makes one LLM call via AtomModelWrapper.
   - Prints the response.

6. **Install in dev mode**  
   Add `atom-sdk` to the Python workspace: `uv pip install -e atom-sdk/`

---

## Technologies

| Technology | Rationale |
|---|---|
| agentscope (forked) | Mature multi-agent orchestration; HITL already integrated |
| AtomModelWrapper | Single provider wrapper; all others removed to prevent provider bypass |
| `httpx` | Async-capable HTTP client for GATE calls; already a dep in agentscope |

---

## Acceptance Criteria

- [ ] `grep -r "OpenAI\|Anthropic\|DashScope\|ZhipuAI" atom-sdk/src/agentscope/models/` — no results.
- [ ] `AtomModelWrapper` instantiates without error.
- [ ] `examples/hello_atom_agent.py` runs and returns an LLM response via GATE + atom-llm.
- [ ] `request_human_decision()` posts to the HITL endpoint and polls for a result.
- [ ] `atom-sdk/UPSTREAM_DIFF.md` documents all removed providers.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-06 of ATOM — the atom-sdk fork of agentscope.

Context: atom-sdk/ is a fork of modelscope/agentscope.
ATOM-specific changes go in dedicated files to minimise merge conflicts.

Tasks:
1. In atom-sdk/src/agentscope/models/, remove all AI provider model wrappers except
   ModelWrapperBase and ModelResponse. Document removals in atom-sdk/UPSTREAM_DIFF.md.
2. Create atom-sdk/src/agentscope/models/atom_model.py:
   - AtomModelWrapper(ModelWrapperBase)
   - __init__: reads ATOM_AGENT_JWT and ATOM_GATE_URL from env
   - __call__: POSTs to {gate_url}/domain/{domain_id}/agent/{agent_id}/v1/chat/completions
     with Authorization: Bearer {jwt}, returns ModelResponse
   - model_type class attribute: "atom"
3. Update atom-sdk/src/agentscope/models/__init__.py to register only AtomModelWrapper
4. Create atom-sdk/src/agentscope/hitl/hiclaw_hooks.py:
   - request_human_decision(payload, timeout_s=300) -> dict
   - POSTs to atom-studio HITL API via GATE, polls every 5s for decision, raises TimeoutError
5. Create atom-sdk/examples/hello_atom_agent.py: minimal agent using AtomModelWrapper
6. Ensure `pip install -e atom-sdk/` works cleanly

Test: Run hello_atom_agent.py against the running GATE+atom-llm stack.
```

---

