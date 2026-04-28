# atom-sdk — Upstream Diff

Upstream: https://github.com/modelscope/agentscope
Snapshot commit: e5d3d6885966af897cf478c22c6272573edf963c
Cloned on: 2026-04-28

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-06.

Key changes planned (SESSION-06):
- Remove all AI provider model wrappers from src/agentscope/models/
  (OpenAI, Anthropic, Gemini, ZhipuAI, DashScope, etc.)
- Add src/agentscope/models/atom_model.py — AtomModelWrapper
  (all LLM calls go via GATE using agent JWT, never direct to providers)
- Add src/agentscope/hitl/hiclaw_hooks.py — HITL integration

None applied yet — changes begin in SESSION-06.
