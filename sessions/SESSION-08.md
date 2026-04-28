# SESSION-08 — atom-studio Agent Provisioning

**Prerequisites:** SESSION-07 complete  
**Goal:** Build the full agent creation and provisioning flow in atom-studio.  
**Estimated time:** 2 days

---

## Tasks

1. **Agent API** (`atom-studio/src/atom_agents/`)
   - `GET    /api/domains/{domain_id}/agents`       — list agents in domain
   - `POST   /api/domains/{domain_id}/agents`       — create agent (see flow below)
   - `GET    /api/domains/{domain_id}/agents/{id}`  — get agent detail
   - `PATCH  /api/domains/{domain_id}/agents/{id}`  — update agent config
   - `DELETE /api/domains/{domain_id}/agents/{id}`  — soft-delete agent
   - `POST   /api/domains/{domain_id}/agents/{id}/regenerate-token` — issue new agent JWT

2. **Agent creation flow** (backend):
   a. Validate request body: name, description, tools (list of tool IDs), skills (list),
      memory config, policies (list), hitl_timeout_seconds.
   b. Create `agents` record with `status = 'draft'`.
   c. Call `POST /atom/provision_agent` on atom-llm → receive `virtual_key`.
   d. Encrypt `virtual_key` with platform AES key; store in `agents.litellm_virtual_key`.
   e. Generate RS256 JWT for the agent:
      ```json
      { "sub": "agent-{id}", "type": "agent", "domain_id": "...", "agent_id": "...",
        "iat": now, "iss": "atom-studio" }
      ```
   f. Store `sha256(token)` in `agent_tokens` table.
   g. Create junction records in `agent_tools`, `agent_skills`, `agent_policies`.
   h. Return `{ agent, token }` — **the raw token is shown only once**.

3. **Tool management API**
   - `GET  /api/tools` — list available tools
   - `POST /api/tools` — register a new tool (endpoint URL + JSON schema)

4. **Skill management API**
   - `GET  /api/skills` — list available skills
   - `POST /api/skills` — register a new skill (pip package name)

5. **Memory config API**
   - `POST /api/memory-configs` — create memory config
   - `GET  /api/memory-configs` — list configs

6. **Token reveal modal** — single-use modal on agent creation that shows the raw JWT.
   "This token will not be shown again. Copy it now and use `atom create agent <token>`."

7. **Agent detail page** (frontend)
   - Shows agent status, tools, skills, policies.
   - "Regenerate token" button (confirms before revoking old token).
   - "Deploy" button → triggers SESSION-09 approval workflow.
   - Links to agent logs (stubs for SESSION-14).

8. **Agent wizard** (frontend) — multi-step:
   - Step 1: Name + description
   - Step 2: Select domain (dropdown)
   - Step 3: Select tools (checkboxes)
   - Step 4: Select skills (checkboxes)
   - Step 5: Memory config (short-term TTL, long-term max vectors)
   - Step 6: Select policies (checkboxes)
   - Step 7: Review + Create

---

## Technologies

| Technology | Rationale |
|---|---|
| AES-GCM (cryptography lib) | Encrypt LiteLLM virtual key at rest |
| RS256 JWT (python-jose) | Agent identity token; same key pair as human JWTs |
| Multi-step form pattern | Wizard UX for complex configuration |

---

## Acceptance Criteria

- [ ] `POST /api/domains/{did}/agents` → creates agent, provisions LiteLLM key, returns JWT.
- [ ] Agent JWT validates successfully in GATE.
- [ ] `SELECT * FROM agent_tokens WHERE agent_id = '{id}'` shows one row.
- [ ] Tool and skill association records exist in junction tables.
- [ ] "Regenerate token" revokes old token and issues a new one.
- [ ] Wizard completes in < 5 clicks for common case (name + default config).

---

## Claude Code Starter Prompt

```
You are implementing SESSION-08 of ATOM — agent provisioning in atom-studio.

Context:
- atom-studio has auth (SESSION-07). Postgres schema is live.
- atom-llm is running and has POST /atom/provision_agent endpoint.
- The platform RS256 private key is at /etc/atom/jwt_private.pem in the pod.

Tasks:
1. Create atom-studio backend: atom_agents/ module with full CRUD for agents
2. Implement the agent creation flow:
   a. Insert agent record (status=draft)
   b. Call atom-llm POST /atom/provision_agent to get virtual_key
   c. Encrypt virtual_key with AES-GCM (key from ATOM_ENCRYPTION_KEY env var)
   d. Store encrypted key in agents.litellm_virtual_key
   e. Generate RS256 agent JWT signed with platform private key
   f. Store sha256(token) in agent_tokens table
   g. Create junction records in agent_tools, agent_skills, agent_policies
   h. Return { agent object, raw_token }

3. Create GET/POST /api/tools and GET/POST /api/skills endpoints
4. Create POST /api/memory-configs endpoint
5. Frontend: multi-step agent creation wizard (7 steps as described)
6. Frontend: agent detail page showing status, tools, skills, "Deploy" button
7. Frontend: single-use token reveal modal (shown only at creation)

Key: the raw JWT must only be returned once. After creation, the token_hash is stored
but the raw token is never retrievable again. Document this in the UI clearly.
```
