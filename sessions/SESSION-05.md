# SESSION-05 — atom-llm (LiteLLM Fork)

**Prerequisites:** SESSION-04 complete  
**Goal:** Fork LiteLLM into atom-llm, configure for ATOM with per-agent virtual keys, tools/skills API, and Kafka audit sink.  
**Estimated time:** 1.5 days

---

## Tasks

1. **Clean up LiteLLM fork** (`atom-llm/`)
   - Remove LiteLLM telemetry and phone-home code.
     Search for: `litellm_telemetry`, `posthog`, `sentry_sdk.capture_exception`, `telemetry=True`.
     Replace all with no-ops or remove entirely. Document in `atom-llm/UPSTREAM_DIFF.md`.
   - Remove LiteLLM proxy UI (we use atom-studio instead).

2. **Add `atom_agent_id` metadata field**  
   In `litellm/proxy/proxy_server.py`, extract `X-ATOM-Agent-ID` header from inbound requests
   and attach as `metadata["atom_agent_id"]` to every LLM call for usage attribution.

3. **Virtual key scoping**  
   LiteLLM already has virtual keys — configure keys to be created per agent at provisioning
   time. Add a `POST /atom/provision_agent` endpoint:
   ```python
   # atom-llm/atom_extensions/provision.py
   POST /atom/provision_agent
   Body: { agent_id, allowed_models: [...], rpm_limit: int, tpm_limit: int }
   Response: { virtual_key: "sk-atom-..." }
   ```
   The virtual key is stored (encrypted) in the `agents.litellm_virtual_key` column in Postgres.

4. **Tools/Skills registration API**  
   New file `atom-llm/atom_extensions/tools_skills.py`:
   ```
   POST /atom/tools        — register a tool endpoint
   GET  /atom/tools        — list registered tools
   POST /atom/skills       — register a skill pip package
   GET  /atom/skills       — list registered skills
   ```

5. **Kafka audit sink**  
   New callback class `atom-llm/atom_extensions/kafka_audit.py`:
   - Extends LiteLLM's `CustomLogger`.
   - On `log_success_event` and `log_failure_event`, produces to Kafka topic `atom.llm`.
   - Event schema: `{ timestamp, agent_id, model, prompt_tokens, completion_tokens, latency_ms, success }`.

6. **MinIO audit sink** (already in LiteLLM) — configure endpoint to internal MinIO.

7. **Network policy** (`infra/manifests/atom-llm-netpol.yaml`):
   ```yaml
   kind: NetworkPolicy
   spec:
     podSelector: { matchLabels: { app: atom-llm } }
     ingress:
       - from: [ { podSelector: { matchLabels: { app: gate } } } ]
     egress:
       - to: [ external LLM endpoints via CIDR ]
       - to: [ kafka, postgres, minio within cluster ]
   ```
   This enforces that ONLY GATE can call atom-llm (agents cannot call it directly).

8. **Docker image** (`atom-llm/Dockerfile`) — extend LiteLLM's existing Dockerfile.

9. **k8s manifest** (`infra/manifests/atom-llm-deployment.yaml`).

10. **Integration test**: call `POST /chat/completions` via GATE using an agent JWT → verify
    `atom.llm` Kafka topic receives an event.

---

## Technologies

| Technology | Rationale |
|---|---|
| LiteLLM OSS fork | 100+ LLM providers, virtual key management, audit log to S3 |
| Kubernetes NetworkPolicy | Enforces GATE-only access to atom-llm; no agent can bypass GATE |
| confluent-kafka-python | LiteLLM is Python; this is the standard Kafka client |

---

## Acceptance Criteria

- [ ] `grep -r "posthog\|litellm_telemetry\|sentry_sdk" atom-llm/` — no results.
- [ ] `POST /atom/provision_agent` returns a virtual key containing `sk-atom-`.
- [ ] `GET /atom/tools` returns JSON list.
- [ ] After a `/chat/completions` call, `atom.llm` Kafka topic has one new message.
- [ ] Direct call to atom-llm from outside GATE is rejected by NetworkPolicy.
- [ ] `atom-llm/UPSTREAM_DIFF.md` documents all changes.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-05 of ATOM — the atom-llm LiteLLM fork.

Context: atom-llm/ is a fork of BerriAI/litellm (MIT license).
We need to make ATOM-specific modifications without breaking LiteLLM core.
All ATOM extensions go in atom-llm/atom_extensions/ to minimise merge conflicts.

Tasks:
1. Create atom-llm/atom_extensions/__init__.py
2. Remove LiteLLM phone-home telemetry — search for posthog, sentry, telemetry flags and
   replace with no-ops. Document every change in atom-llm/UPSTREAM_DIFF.md.
3. Create atom-llm/atom_extensions/provision.py:
   - FastAPI router with POST /atom/provision_agent
   - Creates a LiteLLM virtual key for the agent using LiteLLM's key management API
   - Returns the virtual key
4. Create atom-llm/atom_extensions/tools_skills.py:
   - CRUD endpoints for /atom/tools and /atom/skills
   - Stores in the tools/skills tables in Postgres
5. Create atom-llm/atom_extensions/kafka_audit.py:
   - Class KafkaAuditLogger(CustomLogger)
   - Implements log_success_event and log_failure_event
   - Produces to Kafka topic "atom.llm" using confluent-kafka-python
   - Event: { timestamp, agent_id, model, prompt_tokens, completion_tokens, latency_ms, success }
6. Register extensions in atom-llm's main proxy startup (minimal change to core).
7. Write infra/manifests/atom-llm-netpol.yaml to allow ONLY gate pods to reach atom-llm.
8. Write atom-llm/Dockerfile extending LiteLLM's base.

Test: Use httpie/curl to call POST /atom/provision_agent and verify a virtual key is returned.
```

---

