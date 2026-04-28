#!/usr/bin/env bash
# scripts/clone-upstreams.sh
#
# Run ONCE after cloning this repo (part of SESSION-00).
# Clones each upstream repository into its subdirectory.
#
# IMPORTANT — two kinds of upstream:
#
#   FORKED (we modify these):
#     atom-llm/          ← BerriAI/litellm
#     atom-sdk/          ← agentscope-ai/agentscope (SDK only)
#     atom-runtime/      ← agentscope-ai/agentscope-runtime
#     atom-memory/       ← agentscope-ai/agentscope (memory/reme)
#
#   VISUALIZATION ONLY (we do NOT modify this):
#     agentscope-studio/ ← agentscope-ai/agentscope-studio
#                          Pure Node.js trace viewer. Runs as-is.
#                          atom-studio/ (FastAPI + React) is the management portal.
#
# Usage: bash scripts/clone-upstreams.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ Cloning upstream repositories..."
echo ""

# ── LiteLLM → atom-llm ───────────────────────────────────────────────────────
if [ -d "atom-llm" ]; then
  echo "  atom-llm/ already exists — skipping"
else
  echo "  Cloning BerriAI/litellm → atom-llm/ ..."
  git clone --depth=1 https://github.com/BerriAI/litellm atom-llm
  rm -rf atom-llm/.git
  LITELLM_SHA=$(git -C /tmp/litellm_tmp log --format='%H' -1 2>/dev/null || echo "unknown")
  cat > atom-llm/UPSTREAM_DIFF.md << 'DIFF'
# atom-llm — Upstream Diff

Upstream: https://github.com/BerriAI/litellm

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-05.

None yet — changes begin in SESSION-05.
DIFF
  echo "  ✓ atom-llm/ ready"
fi

# ── agentscope → atom-sdk ────────────────────────────────────────────────────
if [ -d "atom-sdk" ]; then
  echo "  atom-sdk/ already exists — skipping"
else
  echo "  Cloning agentscope-ai/agentscope → atom-sdk/ ..."
  git clone --depth=1 https://github.com/agentscope-ai/agentscope atom-sdk
  rm -rf atom-sdk/.git
  cat > atom-sdk/UPSTREAM_DIFF.md << 'DIFF'
# atom-sdk — Upstream Diff

Upstream: https://github.com/agentscope-ai/agentscope

---

## ATOM-Specific Changes

Key changes (SESSION-06):
- Remove all AI provider model wrappers (only AtomChatWrapper remains)
- Add src/agentscope/models/atom_model.py — AtomChatWrapper + AtomEmbeddingWrapper
- Add src/agentscope/hitl/ — request_human_decision()

None yet — changes begin in SESSION-06.
DIFF
  echo "  ✓ atom-sdk/ ready"
fi

# ── agentscope-runtime → atom-runtime ────────────────────────────────────────
if [ -d "atom-runtime" ]; then
  echo "  atom-runtime/ already exists — skipping"
else
  echo "  Cloning agentscope-ai/agentscope-runtime → atom-runtime/ ..."
  git clone --depth=1 https://github.com/agentscope-ai/agentscope-runtime atom-runtime
  rm -rf atom-runtime/.git
  cat > atom-runtime/UPSTREAM_DIFF.md << 'DIFF'
# atom-runtime — Upstream Diff

Upstream: https://github.com/agentscope-ai/agentscope-runtime

---

## ATOM-Specific Changes

Key changes (SESSION-11):
- Add deploy_webhook.py — receives deployment approval from atom-studio
- Add manifest_builder.py — generates k8s Deployment + Service + NetworkPolicy

None yet — changes begin in SESSION-11.
DIFF
  echo "  ✓ atom-runtime/ ready"
fi

# ── agentscope memory → atom-memory ──────────────────────────────────────────
if [ -d "atom-memory" ]; then
  echo "  atom-memory/ already exists — skipping"
else
  echo "  Cloning agentscope-ai/agentscope → atom-memory/ (memory module) ..."
  # Note: if agentscope memory is in a separate repo (ReMe), update this URL
  git clone --depth=1 https://github.com/agentscope-ai/agentscope atom-memory
  rm -rf atom-memory/.git
  cat > atom-memory/UPSTREAM_DIFF.md << 'DIFF'
# atom-memory — Upstream Diff

Upstream: https://github.com/agentscope-ai/agentscope (memory/reme)
Check also: https://github.com/agentscope-ai/ReMe

---

## ATOM-Specific Changes

Key changes (SESSION-12):
- Add pgvector backend for long-term semantic memory
- Add Redis backend for short-term working memory

None yet — changes begin in SESSION-12.
DIFF
  echo "  ✓ atom-memory/ ready"
fi

# ── agentscope-studio (NOT modified — visualization only) ─────────────────────
if [ -d "agentscope-studio" ]; then
  echo "  agentscope-studio/ already exists — skipping"
else
  echo "  Cloning agentscope-ai/agentscope-studio → agentscope-studio/ ..."
  echo "  NOTE: This is the visualization tool. It is NOT modified by ATOM."
  echo "        atom-studio/ (FastAPI + React) is the management portal."
  git clone --depth=1 https://github.com/agentscope-ai/agentscope-studio agentscope-studio
  # Keep .git — we may want to pull upstream updates directly with git pull
  echo "  ✓ agentscope-studio/ ready (visualization tool — do not modify)"
fi

echo ""
echo "→ Committing upstream snapshots to monorepo..."
git add atom-llm/ atom-sdk/ atom-runtime/ atom-memory/ agentscope-studio/
git commit -m "chore: vendor upstream snapshots

Cloned upstream repositories as subdirectories.
Forked (we modify): atom-llm, atom-sdk, atom-runtime, atom-memory
Visualization only (unmodified): agentscope-studio

atom-studio/ (FastAPI + React management portal) is built from scratch
in SESSION-07 — it is NOT a fork of agentscope-studio."

echo ""
echo "✓ Done. Next: make infra-up → make migrate-up → SESSION-01"
