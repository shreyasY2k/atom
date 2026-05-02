#!/usr/bin/env bash
# setup-dev.sh — install everything needed to run agent.py in dev mode
#
# Creates a Python 3.11+ virtual environment (.venv/), installs atom-sdk,
# then installs all project dependencies inside it.
#
# Usage:
#   bash setup-dev.sh          # first-time setup
#   source .venv/bin/activate  # activate on subsequent sessions
set -e

# ── Locate Python 3.11+ ──────────────────────────────────────────────────────
PYTHON=""
for candidate in python3.13 python3.12 python3.11; do
    if command -v "$candidate" &>/dev/null; then
        PYTHON="$candidate"
        break
    fi
done

if [ -z "$PYTHON" ]; then
    echo "✗ Python 3.11+ not found."
    echo "  macOS: brew install python@3.11"
    echo "  Ubuntu: sudo apt install python3.11 python3.11-venv"
    exit 1
fi

echo "→ Using $PYTHON ($($PYTHON --version))"

# ── Create virtual environment ────────────────────────────────────────────────
if [ ! -d .venv ]; then
    echo "→ Creating virtual environment (.venv/)..."
    "$PYTHON" -m venv .venv
    echo "  ✓ .venv created"
else
    echo "  ✓ .venv already exists"
fi

# Activate it for the rest of this script
# shellcheck source=/dev/null
source .venv/bin/activate

# ── Install atom-sdk ──────────────────────────────────────────────────────────
echo "→ Installing atom-sdk (agentscope fork)..."
ATOM_ROOT=$(python3 -c "
import json, os, sys
cfg = os.path.expanduser('~/.atom/config.json')
try:
    data = json.load(open(cfg))
    root = data.get('atom_root', '')
    if not root:
        sys.exit('atom_root not set in config')
    print(root)
except FileNotFoundError:
    sys.exit('~/.atom/config.json not found — run: bin/atom login  first')
except Exception as e:
    sys.exit(f'config error: {e}')
" 2>&1) || {
    echo "  ⚠  Could not read atom_root from ~/.atom/config.json"
    echo "  Fix: run  bin/atom login  then re-run this script."
    echo "  Or install manually: pip install /path/to/atom-repo/atom-sdk"
    deactivate 2>/dev/null || true
    exit 1
}

pip install --quiet "$ATOM_ROOT/atom-sdk"
echo "  ✓ atom-sdk installed from $ATOM_ROOT/atom-sdk"

# ── Install project dependencies ──────────────────────────────────────────────
echo "→ Installing project dependencies..."
pip install --quiet -r requirements.txt
echo "  ✓ requirements installed"

# ── Configure .env ────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env
    echo "→ .env created from .env.example"
    echo "  ⚠  Edit .env and set LLM_API_KEY before running"
else
    echo "  ✓ .env already exists"
fi

echo ""
echo "✓ Setup complete. Now:"
echo ""
echo "  source .venv/bin/activate   # activate the virtual env"
echo "  # Edit .env — set LLM_API_KEY"
echo "  python agent.py             # run in dev mode"
echo ""
echo "  On future sessions, just:  source .venv/bin/activate && python agent.py"
