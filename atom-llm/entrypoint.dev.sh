#!/bin/bash
# atom-llm dev entrypoint — run prisma db push before starting the server.
# LiteLLM's internal prisma setup is wrapped in a silent try/except, so if
# it fails the proxy starts but all DB-backed operations (virtual key auth,
# team management) fail at request time with "relation does not exist" errors.
# Running prisma db push here makes the failure loud and fast instead.
set -euo pipefail

# Resolve the schema.prisma bundled with the installed litellm package.
SCHEMA=$(python3 -c "import litellm, os; print(os.path.join(os.path.dirname(litellm.__file__), 'proxy', 'schema.prisma'))")

echo "[atom-llm] schema: $SCHEMA"
echo "[atom-llm] running prisma db push..."

# --accept-data-loss: allow destructive schema changes in dev (e.g. after
#   LiteLLM version bump that drops a column).
# --skip-generate: client was already generated at image build time.
prisma db push --schema "$SCHEMA" --accept-data-loss --skip-generate

echo "[atom-llm] schema ready, starting proxy..."
exec python /app/main.py
