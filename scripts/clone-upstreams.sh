#!/usr/bin/env bash
# scripts/clone-upstreams.sh
#
# Run ONCE after cloning this repo (part of SESSION-00).
# Clones each upstream repository into its subdirectory, then commits
# the snapshot to the monorepo.
#
# Usage: bash scripts/clone-upstreams.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "→ Cloning upstream repositories into monorepo..."
echo "  This will take a few minutes depending on connection speed."
echo ""

# ── LiteLLM → atom-llm ───────────────────────────────────────────────────────
if [ -d "atom-llm" ]; then
  echo "  atom-llm/ already exists — skipping"
else
  echo "  Cloning BerriAI/litellm → atom-llm/ ..."
  git clone --depth=1 https://github.com/BerriAI/litellm atom-llm
  rm -rf atom-llm/.git   # detach from upstream — it lives in our monorepo now
  # Create UPSTREAM_DIFF to track our changes against this snapshot
  LITELLM_SHA=$(cd atom-llm && git log --format='%H' -1 2>/dev/null || echo "unknown")
  cat > atom-llm/UPSTREAM_DIFF.md << EOF
# atom-llm — Upstream Diff

Upstream: https://github.com/BerriAI/litellm
Snapshot commit: ${LITELLM_SHA}
Cloned on: $(date -u +%Y-%m-%d)

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-05.
> Format: \`file/path.py\` — what changed and why.

None yet — changes begin in SESSION-05.

---

## How to Merge Upstream Changes

\`\`\`bash
# Fetch a fresh clone, diff against atom-llm/, apply manually
git clone --depth=1 https://github.com/BerriAI/litellm /tmp/litellm-upstream
diff -rq --exclude='.git' /tmp/litellm-upstream atom-llm/ | grep "^Only in /tmp" > /tmp/upstream-new-files.txt
# Review changes and apply selectively, then update the snapshot commit above
\`\`\`
EOF
  echo "  ✓ atom-llm/ ready"
fi

# ── agentscope → atom-sdk ─────────────────────────────────────────────────────
if [ -d "atom-sdk" ]; then
  echo "  atom-sdk/ already exists — skipping"
else
  echo "  Cloning modelscope/agentscope → atom-sdk/ ..."
  git clone --depth=1 https://github.com/modelscope/agentscope atom-sdk
  rm -rf atom-sdk/.git
  AGENTSCOPE_SHA=$(cd atom-sdk && git log --format='%H' -1 2>/dev/null || echo "unknown")
  cat > atom-sdk/UPSTREAM_DIFF.md << EOF
# atom-sdk — Upstream Diff

Upstream: https://github.com/modelscope/agentscope
Snapshot commit: ${AGENTSCOPE_SHA}
Cloned on: $(date -u +%Y-%m-%d)

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
EOF
  echo "  ✓ atom-sdk/ ready"
fi

# ── agentscope-runtime → atom-runtime ────────────────────────────────────────
if [ -d "atom-runtime" ]; then
  echo "  atom-runtime/ already exists — skipping"
else
  echo "  Cloning modelscope/agentscope → atom-runtime/ (runtime subdir) ..."
  # agentscope-runtime may be in the same repo or a separate one
  # Adjust URL if a dedicated repo exists
  git clone --depth=1 https://github.com/modelscope/agentscope atom-runtime
  rm -rf atom-runtime/.git
  cat > atom-runtime/UPSTREAM_DIFF.md << EOF
# atom-runtime — Upstream Diff

Upstream: https://github.com/modelscope/agentscope (runtime components)
Cloned on: $(date -u +%Y-%m-%d)

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-11.

Key changes planned (SESSION-11):
- Add src/atom_runtime/deploy_webhook.py — FastAPI webhook for k8s deployment
- Add src/atom_runtime/manifest_builder.py — generates k8s Deployment + Service + NetworkPolicy
- Integrate with Postgres for deployment configs and approval state

None applied yet — changes begin in SESSION-11.
EOF
  echo "  ✓ atom-runtime/ ready"
fi

# ── agentscope-reme → atom-memory ────────────────────────────────────────────
if [ -d "atom-memory" ]; then
  echo "  atom-memory/ already exists — skipping"
else
  echo "  Cloning modelscope/agentscope → atom-memory/ (reme/memory components) ..."
  git clone --depth=1 https://github.com/modelscope/agentscope atom-memory
  rm -rf atom-memory/.git
  cat > atom-memory/UPSTREAM_DIFF.md << EOF
# atom-memory — Upstream Diff

Upstream: https://github.com/modelscope/agentscope (memory/reme components)
Cloned on: $(date -u +%Y-%m-%d)

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-12.

Key changes planned (SESSION-12):
- Add src/atom_memory/backends/pgvector_backend.py — vector memory via pgvector
- Add src/atom_memory/backends/redis_backend.py — short-term TTL memory via Redis
- Add src/atom_memory/manager.py — MemoryManager routing to correct backend

None applied yet — changes begin in SESSION-12.
EOF
  echo "  ✓ atom-memory/ ready"
fi

# ── agentscope-studio → atom-studio ──────────────────────────────────────────
if [ -d "atom-studio" ]; then
  echo "  atom-studio/ already exists — skipping"
else
  echo "  Cloning modelscope/agentscope → atom-studio/ (studio components) ..."
  git clone --depth=1 https://github.com/modelscope/agentscope atom-studio
  rm -rf atom-studio/.git
  STUDIO_SHA=$(cd atom-studio && git log --format='%H' -1 2>/dev/null || echo "unknown")
  cat > atom-studio/UPSTREAM_DIFF.md << EOF
# atom-studio — Upstream Diff

Upstream: https://github.com/modelscope/agentscope (studio components)
Snapshot commit: ${STUDIO_SHA}
Cloned on: $(date -u +%Y-%m-%d)

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-07, SESSION-08, SESSION-09.

Key changes planned:
- SESSION-07: Add JWT auth layer, domain management API, login UI
- SESSION-08: Add agent provisioning API, agent creation wizard
- SESSION-09: Add HITL dashboard, deployment approval workflow

None applied yet — changes begin in SESSION-07.
EOF
  echo "  ✓ atom-studio/ ready"
fi

echo ""
echo "→ Committing upstream snapshots to monorepo..."
git add atom-llm/ atom-sdk/ atom-runtime/ atom-memory/ atom-studio/
git commit -m "chore: vendor upstream snapshots (LiteLLM, agentscope ×4)

Cloned upstream repositories as subdirectories.
These are NOT git submodules — they live in the monorepo.
Each has UPSTREAM_DIFF.md tracking ATOM-specific changes.

Upstreams:
  atom-llm    ← BerriAI/litellm
  atom-sdk    ← modelscope/agentscope
  atom-runtime ← modelscope/agentscope (runtime)
  atom-memory  ← modelscope/agentscope (memory/reme)
  atom-studio  ← modelscope/agentscope (studio)

Next: run 'make infra-up' then start SESSION-01."

echo ""
echo "✓ All upstream repos cloned and committed."
echo ""
echo "Next steps:"
echo "  1. make infra-up       (deploy kind cluster + infra)"
echo "  2. make migrate-up     (apply database schema)"
echo "  3. Open sessions/SESSION-01.md and begin"
