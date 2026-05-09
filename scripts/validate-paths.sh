#!/usr/bin/env bash
# validate-paths.sh — run all three ATS demo paths and report pass/fail.
# Run this before every rehearsal. If any path fails: fix before demo.
# Rule: if any failure, do not demo live. Fall back to recording.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=============================="
echo "  ATOM Platform path validation"
echo "=============================="

FAIL=0

for path in routine high-value confidence-breach; do
  if bash "$SCRIPT_DIR/run-path.sh" "$path"; then
    echo "  [OK] $path"
  else
    echo "  [FAIL] $path"
    FAIL=1
  fi
  # Brief pause between paths to avoid rate-limit pile-up
  sleep 5
done

echo ""
if [ $FAIL -eq 0 ]; then
  echo "All three paths GREEN. Ready to demo."
  exit 0
else
  echo "One or more paths FAILED. Do not demo live."
  exit 1
fi
