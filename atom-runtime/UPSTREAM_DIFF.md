# atom-runtime — Upstream Diff

Upstream: https://github.com/modelscope/agentscope (runtime components)
Cloned on: 2026-04-28

---

## ATOM-Specific Changes

> Document every change here as made in SESSION-11.

Key changes planned (SESSION-11):
- Add src/atom_runtime/deploy_webhook.py — FastAPI webhook for k8s deployment
- Add src/atom_runtime/manifest_builder.py — generates k8s Deployment + Service + NetworkPolicy
- Integrate with Postgres for deployment configs and approval state

None applied yet — changes begin in SESSION-11.
