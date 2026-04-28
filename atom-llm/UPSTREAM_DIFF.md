# atom-llm — Upstream Diff

Upstream: https://github.com/BerriAI/litellm
Snapshot commit: e5d3d6885966af897cf478c22c6272573edf963c
Cloned on: 2026-04-28

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-05.
> Format: `file/path.py` — what changed and why.

None yet — changes begin in SESSION-05.

---

## How to Merge Upstream Changes

```bash
# Fetch a fresh clone, diff against atom-llm/, apply manually
git clone --depth=1 https://github.com/BerriAI/litellm /tmp/litellm-upstream
diff -rq --exclude='.git' /tmp/litellm-upstream atom-llm/ | grep "^Only in /tmp" > /tmp/upstream-new-files.txt
# Review changes and apply selectively, then update the snapshot commit above
```
