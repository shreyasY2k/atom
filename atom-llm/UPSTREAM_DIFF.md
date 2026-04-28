# atom-llm — Upstream Diff

Upstream: https://github.com/BerriAI/litellm
Snapshot commit: e5d3d6885966af897cf478c22c6272573edf963c
Cloned on: 2026-04-28

---

## ATOM-Specific Changes

### Core file changes (SESSION-05)

**`litellm/proxy/proxy_server.py`**
- Line 1576: `user_telemetry = True` → `user_telemetry = False`
  Why: ATOM is air-gap capable; no phone-home / PostHog analytics allowed.

- `chat_completion()`: Added `X-ATOM-Agent-ID` header → `metadata["atom_agent_id"]`
  Why: GATE injects this so each LLM call is attributed to an ATOM agent.

- End of file: `app.include_router()` for `atom_provision_router` + `atom_tools_router`
  Why: registers ATOM extension endpoints; try/except so proxy starts without extensions.

**`Dockerfile`**
- `COPY atom_extensions/` + `pip install asyncpg confluent-kafka`
  Why: extensions need asyncpg (tools/skills CRUD) and Kafka client (audit sink).

### New ATOM Files (not upstream)

```
atom_extensions/
├── __init__.py       — package marker
├── provision.py      — POST /atom/provision_agent (LiteLLM virtual key generation)
├── tools_skills.py   — GET/POST /atom/tools and /atom/skills
├── kafka_audit.py    — KafkaAuditLogger(CustomLogger) → topic atom.llm
└── startup_hook.py   — registers KafkaAuditLogger via LITELLM_WORKER_STARTUP_HOOKS
```

### Residual sentry_sdk references (harmless)
15 production-file occurrences of `sentry_sdk_instance` remain in litellm core.
All are guarded by `if sentry_sdk_instance is not None` — the instance is always
`None` because ATOM never adds "sentry" to the callbacks list. No data is sent.
Renaming the variable would require touching ~8 core files and risks merge conflicts;
deferred to a future dedicated telemetry-removal PR.

### Files to watch on upstream merge
- `litellm/proxy/proxy_server.py` — 3 change points may conflict
- `Dockerfile` — upstream may change multi-stage build structure

---

## How to Merge Upstream Changes

```bash
# Fetch a fresh clone, diff against atom-llm/, apply manually
git clone --depth=1 https://github.com/BerriAI/litellm /tmp/litellm-upstream
diff -rq --exclude='.git' /tmp/litellm-upstream atom-llm/ | grep "^Only in /tmp" > /tmp/upstream-new-files.txt
# Review changes and apply selectively, then update the snapshot commit above
```
