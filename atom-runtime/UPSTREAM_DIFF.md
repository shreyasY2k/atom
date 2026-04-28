# atom-runtime — Upstream Diff

Upstream: https://github.com/modelscope/agentscope-runtime
Upstream branch tracked: `main`
Last merge from upstream: _not yet merged — populate in 

---

## ATOM-Specific Changes

> Document every change here when made in SESSION-11.
> Format: `file/path.py` — what changed and why.

None yet.

---

## How to Merge Upstream Changes

```bash
git remote add upstream https://github.com/modelscope/agentscope-runtime 2>/dev/null || true
git fetch upstream main
git checkout -b merge/atom-runtime-$(date +%Y%m%d)
git subtree merge --prefix=atom-runtime upstream/main --squash
# resolve conflicts, run tests, open PR
```
