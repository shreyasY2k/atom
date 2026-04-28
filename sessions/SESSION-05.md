# SESSION-05 — atom-llm

**Prerequisites:** SESSION-04 complete (GATE + OPA running)
**Goal:** Set up atom-llm as a LiteLLM proxy with ATOM-specific provisioning endpoints, Kafka audit sink, and per-agent virtual keys scoped to LiteLLM teams.
**Estimated time:** 1.5 days

---

## Context

**atom-llm uses LiteLLM as a PyPI dependency — not a source fork.**

We do NOT clone or modify LiteLLM's source code. LiteLLM is installed via `pyproject.toml` and run as a proxy server. All ATOM-specific behavior lives in `atom-llm/atom_extensions/` as FastAPI routers mounted on top of LiteLLM's proxy app. Upgrading LiteLLM means bumping the version in `pyproject.toml` — no merge conflicts.

### LiteLLM team/agent hierarchy maps directly to ATOM

```
ATOM Domain  →  LiteLLM Team   (budget limits, model allowlist, guardrails at team level)
ATOM Agent   →  LiteLLM Agent  (scoped to team, own virtual key, own rate limits)
```

We use `domain.id` as the LiteLLM `team_id` directly — same UUID, no extra mapping table needed. When atom-studio creates a domain it calls `/atom/provision_domain`. When it creates an agent it calls `/atom/provision_agent`. These are thin wrappers around LiteLLM's native `/team/new` and `/agent/new` APIs.

The virtual key returned by `/agent/new` is already:
- Scoped to the team (domain)
- Restricted to allowed models
- Rate limited (rpm/tpm)
- Guardrails attached (if specified)

No separate `key/generate` call is needed or used.

---

## Repository layout

```
atom-llm/
  pyproject.toml              ← LiteLLM + dependencies
  litellm_config.yaml         ← model list, general settings
  Dockerfile
  main.py                     ← starts LiteLLM proxy + mounts atom_extensions
  atom_extensions/
    __init__.py
    provision.py              ← /atom/provision_domain, /atom/provision_agent
    tools_skills.py           ← /atom/tools, /atom/skills
    kafka_audit.py            ← LiteLLM CustomLogger → Kafka
```

---

## Tasks

### 1. pyproject.toml

```toml
[project]
name = "atom-llm"
version = "0.1.0"
requires-python = ">=3.11"

dependencies = [
    "litellm[proxy]>=1.55.0",
    "fastapi>=0.111.0",
    "uvicorn[standard]>=0.29.0",
    "httpx>=0.27.0",
    "aiokafka>=0.11.0",
    "asyncpg>=0.29.0",
    "python-dotenv>=1.0.0",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

### 2. litellm_config.yaml

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: openai/gpt-4o
      api_key: os.environ/GEMINI_API_KEY

  - model_name: gpt-4o-mini
    litellm_params:
      model: openai/gpt-4o-mini
      api_key: os.environ/GEMINI_API_KEY

  - model_name: text-embedding-3-small
    litellm_params:
      model: openai/text-embedding-3-small
      api_key: os.environ/GEMINI_API_KEY

  # Add Azure, Anthropic, or any other provider here.
  # LiteLLM supports 100+ providers with the same config pattern.
  # Example Azure:
  # - model_name: gpt-4o
  #   litellm_params:
  #     model: azure/gpt-4o
  #     api_base: os.environ/AZURE_OPENAI_API_BASE
  #     api_key: os.environ/AZURE_GEMINI_API_KEY
  #     api_version: os.environ/AZURE_OPENAI_API_VERSION

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  database_url: os.environ/DATABASE_URL
  store_model_in_db: true

litellm_settings:
  success_callback: ["atom_extensions.kafka_audit.KafkaAuditLogger"]
  failure_callback: ["atom_extensions.kafka_audit.KafkaAuditLogger"]
```

### 3. main.py

```python
"""
atom-llm entry point.

Starts LiteLLM proxy and mounts ATOM extension routers on top.
"""
import os
from dotenv import load_dotenv
load_dotenv()

from litellm.proxy.proxy_server import app, ProxyConfig
from atom_extensions.provision import router as provision_router
from atom_extensions.tools_skills import router as tools_router

# Mount ATOM extensions
app.include_router(provision_router)
app.include_router(tools_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)
```

### 4. atom_extensions/provision.py

```python
"""
provision.py — ATOM provisioning endpoints.

Thin wrappers around LiteLLM's native team/agent hierarchy.

ATOM Domain → LiteLLM Team  (domain.id used as team_id directly)
ATOM Agent  → LiteLLM Agent (scoped to team, own key, model limits, guardrails)

Called by atom-studio backend during domain and agent creation.
Never called directly by agents.
"""
import os
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/atom", tags=["atom-provision"])

LITELLM_BASE = "http://localhost:4000"
MASTER_KEY   = os.environ["LITELLM_MASTER_KEY"]
HEADERS      = {"Authorization": f"Bearer {MASTER_KEY}",
                "Content-Type": "application/json"}


class ProvisionDomainRequest(BaseModel):
    domain_id:   str    # ATOM domain UUID — used directly as LiteLLM team_id
    domain_name: str

class ProvisionDomainResponse(BaseModel):
    team_id:    str
    team_alias: str

class ProvisionAgentRequest(BaseModel):
    agent_id:       str
    agent_name:     str
    team_id:        str          # domain.litellm_team_id (= domain.id)
    allowed_models: list[str]
    rpm_limit:      int = 60
    tpm_limit:      int = 100_000
    guardrails:     list[str] = []

class ProvisionAgentResponse(BaseModel):
    litellm_agent_id: str
    virtual_key:      str

class DeprovisionRequest(BaseModel):
    litellm_id: str


@router.post("/provision_domain", response_model=ProvisionDomainResponse)
async def provision_domain(req: ProvisionDomainRequest):
    """
    Create a LiteLLM team for this ATOM domain.
    Called by atom-studio immediately after domain INSERT.
    Uses domain.id as team_id so there is no separate ID to track.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{LITELLM_BASE}/team/new",
            headers=HEADERS,
            json={
                "team_id":    req.domain_id,
                "team_alias": req.domain_name,
            },
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"LiteLLM /team/new failed: {resp.text}")
    data = resp.json()
    return ProvisionDomainResponse(
        team_id=data.get("team_id", req.domain_id),
        team_alias=data.get("team_alias", req.domain_name),
    )


@router.post("/provision_agent", response_model=ProvisionAgentResponse)
async def provision_agent(req: ProvisionAgentRequest):
    """
    Create a LiteLLM agent for this ATOM agent, scoped to the team (domain).

    Steps:
      1. Add agent as a member of the LiteLLM team
      2. Create LiteLLM agent scoped to that team
         → response contains virtual_key already scoped, rate-limited, guardrailed

    The returned virtual_key replaces any key/generate call.
    atom-studio stores it AES-GCM encrypted in agents.litellm_virtual_key.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        # Step 1: add as team member
        member_resp = await client.post(
            f"{LITELLM_BASE}/team/member_add",
            headers=HEADERS,
            json={
                "team_id": req.team_id,
                "member":  [{"role": "user", "user_id": req.agent_id}],
            },
        )
        if member_resp.status_code not in (200, 201):
            raise HTTPException(502, f"LiteLLM /team/member_add failed: {member_resp.text}")

        # Step 2: create agent scoped to team
        agent_body: dict = {
            "agent_alias": req.agent_name,
            "team_id":     req.team_id,
            "model":       req.allowed_models[0] if req.allowed_models else "gpt-4o",
            "tpm_limit":   req.tpm_limit,
            "rpm_limit":   req.rpm_limit,
        }
        if req.guardrails:
            agent_body["guardrails"] = req.guardrails

        agent_resp = await client.post(
            f"{LITELLM_BASE}/agent/new",
            headers=HEADERS,
            json=agent_body,
        )
        if agent_resp.status_code not in (200, 201):
            raise HTTPException(502, f"LiteLLM /agent/new failed: {agent_resp.text}")
        agent_data = agent_resp.json()

    virtual_key = agent_data.get("key") or agent_data.get("virtual_key")
    if not virtual_key:
        raise HTTPException(502, f"LiteLLM /agent/new returned no key: {agent_data}")

    return ProvisionAgentResponse(
        litellm_agent_id=agent_data.get("agent_id", req.agent_id),
        virtual_key=virtual_key,
    )


@router.delete("/deprovision_agent")
async def deprovision_agent(req: DeprovisionRequest):
    """Called by atom-studio when an agent is deleted."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.delete(
            f"{LITELLM_BASE}/agent/delete",
            headers=HEADERS,
            json={"agent_id": req.litellm_id},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"LiteLLM /agent/delete failed: {resp.text}")
    return {"deleted": True}


@router.delete("/deprovision_domain")
async def deprovision_domain(req: DeprovisionRequest):
    """Called by atom-studio when a domain is deleted."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{LITELLM_BASE}/team/delete",
            headers=HEADERS,
            json={"team_ids": [req.litellm_id]},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"LiteLLM /team/delete failed: {resp.text}")
    return {"deleted": True}
```

### 5. atom_extensions/tools_skills.py

```python
"""
tools_skills.py — tool and skill registration endpoints.

Tools are HTTP endpoints agents can call via GATE.
Skills are Python packages installed into agent pods.
Both are stored in Postgres and exposed here for atom-studio to manage.
"""
import os
import asyncpg
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/atom", tags=["atom-tools-skills"])

DB_URL = os.environ["DATABASE_URL"]


class ToolIn(BaseModel):
    name:        str
    description: str = ""
    endpoint:    str
    schema_json: dict = {}

class SkillIn(BaseModel):
    name:        str
    description: str = ""
    pip_package: str


@router.get("/tools")
async def list_tools():
    conn = await asyncpg.connect(DB_URL)
    rows = await conn.fetch(
        "SELECT id, name, description, endpoint, schema_json FROM tools WHERE is_active=true"
    )
    await conn.close()
    return [dict(r) for r in rows]


@router.post("/tools", status_code=201)
async def register_tool(tool: ToolIn):
    conn = await asyncpg.connect(DB_URL)
    row = await conn.fetchrow("""
        INSERT INTO tools (name, description, endpoint, schema_json)
        VALUES ($1, $2, $3, $4) RETURNING id, name
    """, tool.name, tool.description, tool.endpoint, str(tool.schema_json))
    await conn.close()
    return dict(row)


@router.get("/skills")
async def list_skills():
    conn = await asyncpg.connect(DB_URL)
    rows = await conn.fetch(
        "SELECT id, name, description, pip_package FROM skills WHERE is_active=true"
    )
    await conn.close()
    return [dict(r) for r in rows]


@router.post("/skills", status_code=201)
async def register_skill(skill: SkillIn):
    conn = await asyncpg.connect(DB_URL)
    row = await conn.fetchrow("""
        INSERT INTO skills (name, description, pip_package)
        VALUES ($1, $2, $3) RETURNING id, name
    """, skill.name, skill.description, skill.pip_package)
    await conn.close()
    return dict(row)
```

### 6. atom_extensions/kafka_audit.py

```python
"""
kafka_audit.py — LiteLLM CustomLogger that produces to Kafka.

Every LLM call (success or failure) is published to atom.llm topic.
atom-studio and log-archiver consume this for real-time display and archival.
"""
import os
import json
import time
from litellm.integrations.custom_logger import CustomLogger
from aiokafka import AIOKafkaProducer
import asyncio

KAFKA_BROKERS = os.environ.get("KAFKA_BROKERS", "localhost:9092")
TOPIC         = "atom.llm"

_producer: AIOKafkaProducer | None = None

async def _get_producer() -> AIOKafkaProducer:
    global _producer
    if _producer is None:
        _producer = AIOKafkaProducer(bootstrap_servers=KAFKA_BROKERS)
        await _producer.start()
    return _producer


class KafkaAuditLogger(CustomLogger):
    def log_success_event(self, kwargs, response_obj, start_time, end_time):
        asyncio.create_task(self._produce(kwargs, response_obj, start_time, end_time, True))

    def log_failure_event(self, kwargs, response_obj, start_time, end_time):
        asyncio.create_task(self._produce(kwargs, response_obj, start_time, end_time, False))

    async def _produce(self, kwargs, response_obj, start_time, end_time, success: bool):
        try:
            metadata  = kwargs.get("litellm_params", {}).get("metadata", {})
            usage     = getattr(response_obj, "usage", None)
            event = {
                "timestamp":        time.time(),
                "atom_agent_id":    metadata.get("atom_agent_id", ""),
                "model":            kwargs.get("model", ""),
                "prompt_tokens":    getattr(usage, "prompt_tokens", 0) if usage else 0,
                "completion_tokens":getattr(usage, "completion_tokens", 0) if usage else 0,
                "latency_ms":       (end_time - start_time).total_seconds() * 1000,
                "success":          success,
            }
            producer = await _get_producer()
            await producer.send(
                TOPIC,
                key=metadata.get("atom_agent_id", "unknown").encode(),
                value=json.dumps(event).encode(),
            )
        except Exception as e:
            print(f"[kafka_audit] Failed to produce: {e}")
```

### 7. Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e .

COPY . .

EXPOSE 4000

CMD ["python", "main.py"]
```

### 8. Add ATOM_LLM_URL to GATE config and docker-compose

In `gate/internal/config/config.go` ensure:
```go
AtomLLMURL string `env:"ATOM_LLM_URL" envDefault:"http://atom-llm:4000"`
```

In `docker-compose.dev.yml` under the gate service environment:
```yaml
ATOM_LLM_URL: http://atom-llm:4000
```

---

## Environment variables required

```bash
# .env
LITELLM_MASTER_KEY=sk-atom-master-changeme   # any string, used to call LiteLLM internal API
GEMINI_API_KEY=sk-...                         # or whichever provider you use
DATABASE_URL=postgresql://atom:pass@postgres:5432/atom
KAFKA_BROKERS=localhost:9092
MINIO_ENDPOINT=http://minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=changeme
```

---

## Acceptance Criteria

- [x] `docker compose up -d --build atom-llm` starts cleanly, logs show `Uvicorn running on port 4000`
- [x] `curl http://localhost:4000/health/liveliness` → `"I'm alive!"`
- [x] `POST /atom/provision_domain` → creates LiteLLM team, returns `{ team_id, team_alias }`
- [x] `POST /atom/provision_agent` → creates LiteLLM virtual key scoped to team, returns `{ litellm_agent_id, virtual_key }` (**Note:** LiteLLM 1.83 removed `/agent/new`; ATOM uses `/key/generate` with `team_id` instead)
- [x] Direct LLM call with virtual key works (tested with gemini-2.5-flash via real Gemini API)
- [ ] After a successful LLM call, `atom.llm` Kafka topic has one new message (Redpanda not in dev stack)
- [x] `GET /atom/tools` and `GET /atom/skills` return empty lists (no error)
- [x] `DELETE /atom/deprovision_agent` removes the LiteLLM key
- [x] `DELETE /atom/deprovision_domain` removes the LiteLLM team

### Implementation notes (completed 2026-04-28)
- `main.py` uses `app.include_router()` — no source patching of proxy_server.py
- `Dockerfile.dev` installs LiteLLM from PyPI, copies `atom_extensions/` + `main.py`, runs `python main.py`
- `CONFIG_FILE_PATH=/app/config.dev.yaml` env var tells LiteLLM where to load models from
- `KafkaAuditLogger` inherits from `CustomLogger` to get default no-op hooks (LiteLLM 1.83 calls `async_post_call_success_hook` on all callbacks)
- `provision_agent` uses `/key/generate` (not the removed `/agent/new`) with `key_alias={name}-{agent_id[:8]}` for global uniqueness
- `deprovision_agent` accepts `virtual_key` (the `sk-...` string) and calls `/key/delete`
- ATOM migrations (000001–000008) must be applied once to create `tools`/`skills` tables

---

## Claude Code Starter Prompt

```
You are implementing SESSION-05 of ATOM — atom-llm.

atom-llm uses LiteLLM as a PyPI dependency (not a source fork).
All ATOM extensions go in atom-llm/atom_extensions/ as FastAPI routers
mounted on top of LiteLLM's proxy app.

The LiteLLM team/agent hierarchy maps to ATOM:
  ATOM Domain → LiteLLM Team  (team_id = domain.id, same UUID)
  ATOM Agent  → LiteLLM Agent (scoped to team, own key, model limits, guardrails)

Tasks:
1. Create atom-llm/pyproject.toml with litellm[proxy]>=1.84.0
2. Create atom-llm/litellm_config.yaml with at least one model configured
   (use GEMINI_API_KEY env var)
3. Create atom-llm/main.py that starts LiteLLM proxy and mounts atom_extensions routers
4. Create atom-llm/atom_extensions/provision.py with four endpoints:
   - POST /atom/provision_domain → calls LiteLLM /team/new (domain.id as team_id)
   - POST /atom/provision_agent  → calls /team/member_add then /agent/new
   - DELETE /atom/deprovision_agent → calls /agent/delete
   - DELETE /atom/deprovision_domain → calls /team/delete
   All internal LiteLLM calls use LITELLM_MASTER_KEY in Authorization header
5. Create atom-llm/atom_extensions/tools_skills.py with GET/POST /atom/tools and /atom/skills
6. Create atom-llm/atom_extensions/kafka_audit.py with KafkaAuditLogger(CustomLogger)
   that produces to atom.llm Kafka topic on every LLM success/failure
7. Create atom-llm/Dockerfile
8. docker compose up -d --build atom-llm

Verify:
- POST /atom/provision_domain returns { team_id, team_alias }
- POST /atom/provision_agent returns { litellm_agent_id, virtual_key }
- Direct /v1/chat/completions with the virtual_key returns a real LLM response
```
