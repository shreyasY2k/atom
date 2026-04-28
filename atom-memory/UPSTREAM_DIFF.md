# atom-memory — Upstream Diff

Upstream: https://github.com/modelscope/agentscope-reme
Upstream branch tracked: `main`
Last merge from upstream: _not yet merged — populate in 

---

## ATOM-Specific Changes

> Document every change here when made in SESSION-12.
> Format: `file/path.py` — what changed and why.

None yet.

---

## How to Merge Upstream Changes

```bash
git remote add upstream https://github.com/modelscope/agentscope-reme 2>/dev/null || true
git fetch upstream main
git checkout -b merge/atom-memory-$(date +%Y%m%d)
git subtree merge --prefix=atom-memory upstream/main --squash
# resolve conflicts, run tests, open PR
```
