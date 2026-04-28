# atom-sdk — Upstream Diff

Upstream: https://github.com/modelscope/agentscope
Snapshot commit: e5d3d6885966af897cf478c22c6272573edf963c
Cloned on: 2026-04-28

---

## ATOM-Specific Changes (SESSION-06)

### New files

**`src/agentscope/model/_atom_model.py`** — `AtomChatModel(OpenAIChatModel)`
  Routes all chat completions through GATE → atom-llm.
  Reads ATOM_GATE_URL, ATOM_DOMAIN_ID, ATOM_AGENT_ID, ATOM_AGENT_JWT from env.
  Does NOT accept api_key, base_url, or client_kwargs — enforces GATE-only routing.

**`src/agentscope/embedding/_atom_embedding.py`** — `AtomTextEmbedding(OpenAITextEmbedding)`
  Routes all embedding calls through GATE → atom-llm. Same env var pattern.

**`src/agentscope/hitl/__init__.py`** and **`hitl/hiclaw_hooks.py`**
  `request_human_decision(payload, timeout_s, poll_interval_s)` — submits to the
  atom-studio HITL queue and polls every 5s until approved/rejected or timeout.

**`examples/hello_atom.py`** — minimal working example using AtomChatModel.

### Modified files

**`src/agentscope/model/__init__.py`**
  Rewritten to export only: ChatModelBase, ChatResponse, ChatUsage, AtomChatModel.

**`src/agentscope/embedding/__init__.py`**
  Rewritten to export only: EmbeddingModelBase, EmbeddingUsage, EmbeddingResponse,
  EmbeddingCacheBase, FileEmbeddingCache, AtomTextEmbedding.

**`src/agentscope/memory/_long_term_memory/_reme/_reme_long_term_memory_base.py`**
  Updated imports to use ChatModelBase/EmbeddingModelBase base classes; DashScope
  isinstance branch removed (AtomChatModel inherits OpenAIChatModel path).

### Deleted model files (provider bypass prevention)

`src/agentscope/model/`:
- `_anthropic_model.py` — AnthropicChatModel. Direct provider bypass.
- `_dashscope_model.py` — DashScopeChatModel. Direct provider bypass.
- `_gemini_model.py`    — GeminiChatModel. Direct provider bypass.
- `_ollama_model.py`    — OllamaChatModel. Direct provider bypass.
- `_trinity_model.py`   — TrinityChatModel. Deprecated upstream, wraps OpenAI.

`src/agentscope/embedding/`:
- `_dashscope_embedding.py`          — Direct provider bypass.
- `_dashscope_multimodal_embedding.py` — Direct provider bypass.
- `_gemini_embedding.py`             — Direct provider bypass.
- `_ollama_embedding.py`             — Direct provider bypass.

### Architecture invariant enforced

Every agent must use `AtomChatModel` or `AtomTextEmbedding`.
These classes read their endpoint and credentials exclusively from ATOM env vars
(injected by atom-runtime). There is no config knob to route around GATE.
