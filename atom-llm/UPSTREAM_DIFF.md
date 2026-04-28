# atom-llm — Upstream Diff

Upstream: https://github.com/BerriAI/litellm  
Upstream branch tracked: `main`  
Last merge from upstream: _not yet merged — populate in SESSION-05_

---

## ATOM-Specific Changes

> Document every change here when made in SESSION-05.
> Format: `file/path.py` — what changed and why.

None yet.

---

## How to Merge Upstream Changes

```bash
# 1. Fetch latest upstream into a temp branch
git remote add litellm-upstream https://github.com/BerriAI/litellm 2>/dev/null || true
git fetch litellm-upstream main

# 2. Create a merge branch
git checkout -b merge/litellm-$(date +%Y%m%d)

# 3. Merge (expect conflicts in files we've modified)
git subtree merge --prefix=atom-llm litellm-upstream/main --squash

# 4. Resolve conflicts — our atom_extensions/ dir should never conflict
#    since it doesn't exist in upstream
git mergetool

# 5. Verify all ATOM-specific changes in this file are still present
# 6. Run tests: make test-python
# 7. PR the merge branch
```
