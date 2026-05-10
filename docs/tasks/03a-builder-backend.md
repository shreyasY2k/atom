# Task 03a — Builder Backend

## Goal

`builder-backend` (FastAPI on port 8080) accepts agent specs, validates them, generates AgentScope code via the builder skill, builds a container, and **issues a service-account identity in LiteLLM** at deploy time. Maintains an agent registry.

## Endpoints to implement

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/specs/agent/validate` | Validate `agent-spec.yaml` against schema |
| `POST` | `/specs/agent/generate` | NL prose → `agent-spec.yaml` (Mode A; uses LiteLLM + builder skill) |
| `POST` | `/agents/{name}/compile` | Spec → AgentScope `agent.py` (uses builder SKILL.md) |
| `POST` | `/agents/{name}/deploy` | Build container, issue service-account, register, run |
| `GET` | `/agents` | List registered agents |
| `GET` | `/agents/{name}` | Get agent record (incl. service_account_id) |
| `POST` | `/agents/{name}/invoke` | Proxy to deployed agent (used by workflow engine) |
| `DELETE` | `/agents/{name}` | Undeploy + revoke service-account |

## Identity issuance (the load-bearing piece)

When `/agents/{name}/deploy` is called:

1. Compute `service_account_id = f"svc-acct-{name}-{spec_hash[:8]}"`
2. POST to LiteLLM `/key/generate` with:
   ```json
   {
     "key_alias": "svc-acct-kyc-refresh-a3f9b2c1",
     "models": ["gemini-3.1-pro", "gemini-3-flash", "gemini-embedding-2"],
     "max_budget": 10.0,
     "tpm_limit": 200000,
     "metadata": {
       "actor_type": "agent",
       "agent_name": "kyc-refresh",
       "version": "1.0.0",
       "owner": "user:demo@atom.demo",
       "tool_allowlist": ["get_customer_profile", "get_kyc_documents", "get_external_screening"]
     }
   }
   ```
3. Capture the returned `key` (the actual virtual key string)
4. Build the agent's container with `LITELLM_API_KEY=<that key>` and `SERVICE_ACCOUNT_ID=<the alias>` injected as env vars
5. Start the container; register endpoint in `agents` registry table
6. Emit deploy audit event: `{actor_type: system, action: deploy_agent, target: <name>, identity_issued: <service_account_id>}` to `minio://audit-logs/deploy/`

On `DELETE /agents/{name}`:
1. Stop + remove container
2. POST to LiteLLM `/key/delete` to revoke the virtual key
3. Mark registry record as `status: undeployed`
4. Emit deploy audit event for the revocation

## Code generation flow (Mode A)

`POST /specs/agent/generate`:
1. Validate inbound NL prose isn't empty / ridiculously long
2. Build prompt using the **builder SKILL.md** as system prompt + the user's prose as user message + the relevant domain skill files as context
3. Call Gemini 3.1 Pro with structured output (`response_format` with the agent-spec JSON schema)
4. Parse + validate the returned spec
5. Return both spec and a suggested skill file content

## Code compilation

`POST /agents/{name}/compile`:
1. Read `specs/agents/{name}.yaml`
2. Read referenced skill files
3. Build prompt: builder SKILL.md as system + spec + skills as user message
4. Call Gemini with structured output (or just text completion expecting Python)
5. AST-parse the result to verify it's syntactically valid
6. Run lint checks for required imports (`from agentscope`, `LITELLM_BASE_URL`, `SERVICE_ACCOUNT_ID`, `from tools.registry import resolve_tools`, `temperature=1.0`, `AgentApp(`)
7. Hash the generated code; store in `minio://agent-artifacts/{name}/{version}/agent.py`

## File layout

```
builder-backend/
├── Dockerfile
├── requirements.txt
├── pyproject.toml
└── app/
    ├── __init__.py
    ├── main.py                  # FastAPI app + routes
    ├── routes/
    │   ├── specs.py             # validate + generate
    │   ├── agents.py            # compile + deploy + invoke
    │   └── registry.py          # list + get + delete
    ├── core/
    │   ├── schema.py            # Pydantic models for agent-spec
    │   ├── codegen.py           # spec → code (uses builder SKILL.md)
    │   ├── container.py         # docker build + run
    │   ├── identity.py          # LiteLLM virtual key lifecycle
    │   ├── audit.py             # MinIO audit event emit
    │   └── litellm_client.py    # LiteLLM API client
    ├── tools/
    │   ├── __init__.py
    │   └── registry.py          # resolve_tools(domain, names)
    └── memory/
        ├── __init__.py
        └── reme_client.py       # ReMe HTTP client
```

The `tools/registry.py` and `memory/reme_client.py` must also be **copied into deployed agent containers** because the generated code imports them.

## Tools registry

The registry maps tool names → Python callables. Each callable is a thin wrapper around an HTTP call to one of the mock services. Examples:

```python
# tools/registry.py (excerpt)
import os
import httpx

def get_customer_profile(customer_id: str) -> dict:
    """Pull current KYC profile for a customer."""
    url = f"{os.environ['KYC_SVC_URL']}/profile/{customer_id}"
    return httpx.get(url, timeout=10).json()

def get_kyc_documents(customer_id: str) -> dict:
    """Pull KYC documents on file."""
    url = f"{os.environ['KYC_SVC_URL']}/documents/{customer_id}"
    return httpx.get(url, timeout=10).json()

def get_external_screening(customer_id: str, name: str = None, address: str = None) -> dict:
    """Run adverse-media + PEP screening."""
    url = f"{os.environ['KYC_SVC_URL']}/screening"
    return httpx.post(url, json={"customer_id": customer_id}, timeout=10).json()

def get_customer_positions(transfer_id: str) -> dict:
    """Pull customer's current positions."""
    # Stubbed — for demo, return synthetic positions matching common transfers
    return {"transfer_id": transfer_id, "positions": [...]}

# ... etc

DOMAIN_TOOLS = {
    "banking-kyc": [get_customer_profile, get_kyc_documents, get_external_screening],
    "banking-securities-ops": [get_customer_positions, get_security_master, check_position_lots],
    "banking-treasury": [...],
    "insurance-claims": [...],
}

def resolve_tools(domain, names):
    available = {f.__name__: f for f in DOMAIN_TOOLS.get(domain, [])}
    return [available[n] for n in names if n in available]
```

## Definition of Done

- [ ] `POST /specs/agent/validate` works against the existing 4 specs (treasury, insurance, kyc-refresh, asset-recon)
- [ ] `POST /specs/agent/generate` produces a valid spec from a 1-line prose description
- [ ] `POST /agents/kyc-refresh/compile` produces parseable AgentScope code
- [ ] `POST /agents/kyc-refresh/deploy` issues a service-account in LiteLLM, builds, runs the container, registers it
- [ ] `GET /agents/kyc-refresh` shows `service_account_id` populated and `status: deployed`
- [ ] Deployed agent's `/health` endpoint responds
- [ ] Deployed agent's `/invoke` returns a valid JSON response when called with a sample customer_id
- [ ] An LLM call from the deployed agent appears in `minio://audit-logs/llm/...` tagged with the service-account ID, NOT the human user
- [ ] `DELETE /agents/kyc-refresh` revokes the LiteLLM key and stops the container

## Common pitfalls

- **Hardcoding the LiteLLM master key in deployed containers**: never. Each agent gets its own virtual key.
- **Forgetting to inject SERVICE_ACCOUNT_ID env var**: the generated code will assert and crash.
- **Generated code imports `google.generativeai` directly**: builder skill must reject this; if it slips through, lint fails.
- **Audit event has `actor_type: human` for an agent's LLM call**: the LiteLLM virtual key's metadata is the source of truth; verify metadata is being passed through to S3 callback.
