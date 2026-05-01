# ATOM — Architecture & Flows

---

## 1. System Architecture

```mermaid
flowchart TB
    subgraph external["External World"]
        EC["External Callers\n(banks · fintechs)"]
        DEV["Developer"]
    end

    subgraph tooling["Developer Tooling"]
        ST["atom-studio\n(UI + FastAPI)"]
        CL["atom-cli\n(Go + Cobra)"]
        REG["Container Registry\n(GHCR / kind load\nor any OCI registry)"]
    end

    subgraph gateway["Gateway Layer — atom-system namespace"]
        GATE["GATE\nGo · Fiber v3\nJWT · OPA · rate-limit · audit · proxy"]
        OPA["OPA\nRego policies\n(in-process)"]
    end

    subgraph services["Core Services — atom-system namespace"]
        LLM["atom-llm\nLiteLLM fork\nvirtual keys · tools · skills"]
        MEM["atom-memory\npgvector + Redis\n(library, not a pod)"]
        HITL["HITL queue\nin atom-studio API"]
        RUNTIME["atom-runtime\nk8s deployment controller"]
    end

    subgraph agents["Agent Runtime — atom-agents namespace"]
        PODS["Agent Pods\natom-sdk\n/domain/id/agent/id"]
    end

    subgraph data["Data Layer — atom-infra namespace"]
        PG[("Postgres 16\n+ pgvector")]
        RD[("Redis 7")]
        KF[("Kafka\nRedpanda")]
        MN[("MinIO\natom-audit bucket")]
    end

    subgraph obs["Observability — atom-system namespace"]
        AL["Grafana Alloy\nOTEL collector\n+ log shipper"]
        LK["Grafana Loki\nlog store"]
        TP["Grafana Tempo\ntrace store"]
        GR["Grafana\ndashboards"]
    end

    DEV -- "manage agents\napprove deploys\nview audit" --> ST
    DEV -- "atom create\natom validate\natom deploy" --> CL
    EC -- "HTTPS" --> GATE
    ST -- "HTTPS" --> GATE
    CL -- "HTTPS" --> GATE

    GATE <-- "in-process\npolicy eval" --> OPA
    GATE -- "proxy request\nto agent pod" --> PODS
    GATE -- "LLM calls\n(NetworkPolicy enforced)" --> LLM
    GATE -- "memory ops" --> MEM
    GATE -- "HITL requests" --> HITL

    PODS -- "LLM calls via GATE\n(agent JWT)" --> GATE

    ST -- "deploy webhook\non approval" --> RUNTIME
    RUNTIME -- "k8s Deployment\nService\nNetworkPolicy" --> PODS
    CL -- "docker push" --> REG
    REG -- "image pull" --> PODS

    GATE -- "read routing\nwrite audit chain" --> PG
    GATE -- "rate-limit\ntoken cache\nrouting cache" --> RD
    GATE -- "atom.audit events\nasync" --> KF
    LLM -- "atom.llm events" --> KF
    LLM -- "config\nvirtual keys" --> PG
    MEM -- "vector storage\nHNSW search" --> PG
    MEM -- "short-term TTL" --> RD
    KF -- "archive\nbatch files" --> MN
    ST -- "read/write\nall schema" --> PG

    GATE -- "OTLP traces\n(HTTP :4318)" --> AL
    LLM -- "OTLP traces" --> AL
    ST -- "OTLP traces" --> AL
    PODS -- "k8s pod logs\n(loki.source.kubernetes)" --> AL
    AL -- "traces" --> TP
    AL -- "logs" --> LK
    TP --- GR
    LK --- GR
```

---

## 2. Deployment Flow

> **The most important flow to understand first.**
> The image is built and pushed BEFORE the approval request is submitted.
> Studio stores the image reference. On approval, atom-runtime reads it and creates the k8s Deployment.

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant CLI as atom-cli
    participant Reg as Container Registry
    participant Studio as atom-studio API
    participant PG as Postgres
    participant WS as WebSocket (push)
    participant Admin as Platform Admin
    participant Runtime as atom-runtime
    participant K8s as Kubernetes API
    participant GATE as GATE

    Dev->>CLI: atom deploy
    Note over CLI: reads atom_agent.yaml<br/>agent_id, domain_id, image config

    CLI->>CLI: docker build -t registry/agent-name:sha .
    CLI->>Reg: docker push registry/agent-name:sha
    Reg-->>CLI: pushed ✓

    CLI->>Studio: POST /api/deployments/{agent_id}<br/>{ image: "registry/agent-name:sha",<br/>  git_sha, message }
    Studio->>PG: INSERT deployments<br/>{ agent_id, image, status=pending,<br/>  manifest_json=null }
    Studio->>PG: INSERT hitl_workflows<br/>{ type=DEPLOYMENT_APPROVAL,<br/>  payload={image, sha, message} }
    Studio-->>CLI: { deployment_id, status: "pending_approval" }
    CLI->>CLI: poll GET /api/deployments/{id}/status every 5s

    Studio->>WS: broadcast { type: DEPLOYMENT_PENDING,<br/>agent, image, submitted_by }
    WS->>Admin: badge ++ in HITL queue

    Admin->>Studio: GET /api/hitl/queue (sees pending deployment)
    Admin->>Studio: POST /api/hitl/{id}/decide<br/>{ approved: true, note: "reviewed" }
    Studio->>PG: UPDATE hitl_workflows SET status=approved
    Studio->>PG: UPDATE deployments SET status=approved

    Studio->>Runtime: POST /runtime/deploy<br/>{ agent_id, domain_id,<br/>  image: "registry/agent-name:sha",<br/>  memory_config_id }

    Runtime->>PG: SELECT agents, agent_tools, agent_skills,<br/>agent_policies, memory_configs
    PG-->>Runtime: full agent configuration

    Runtime->>Runtime: Build k8s manifests:<br/>Deployment + Service + NetworkPolicy
    Note over Runtime: Deployment spec:<br/>image: registry/agent-name:sha<br/>env: ATOM_AGENT_JWT (from Secret)<br/>env: ATOM_GATE_URL<br/>env: ATOM_AGENT_ID, ATOM_DOMAIN_ID<br/>resources: requests+limits set<br/>securityContext: runAsNonRoot

    Runtime->>K8s: kubectl apply Deployment<br/>agent-{id} in atom-agents ns
    Runtime->>K8s: kubectl apply Service<br/>agent-{id}.atom-agents.svc:8080
    Runtime->>K8s: kubectl apply NetworkPolicy<br/>ingress: only from gate pods

    K8s->>Reg: pull registry/agent-name:sha
    Reg-->>K8s: image layers
    K8s-->>Runtime: Deployment created

    Runtime->>K8s: wait --for=condition=ready pod
    K8s-->>Runtime: pod ready ✓

    Runtime->>PG: UPDATE agents SET<br/>cluster_service_name=agent-{id}.atom-agents.svc.cluster.local<br/>status=deployed
    Runtime->>PG: UPDATE deployments SET status=deployed, deployed_at=now()
    Runtime->>Studio: WebSocket: deploy_complete { agent_id, url }

    Studio->>WS: broadcast { type: DEPLOY_COMPLETE,<br/>url: /domain/{did}/agent/{aid} }
    WS-->>CLI: { status: deployed,<br/>url: /domain/{did}/agent/{aid} }
    CLI-->>Dev: Agent live at /domain/{did}/agent/{aid}

    Note over GATE: Next request to this agent:<br/>reads cluster_service_name from Postgres<br/>caches in Redis for 60s<br/>proxies to agent-{id}.atom-agents.svc:8080
```

### Container Registry Setup

**Local development (kind):**
```bash
# Build agent image and make it available to the kind cluster
docker build -t my-loan-agent:$(git rev-parse --short HEAD) .
kind load docker-image my-loan-agent:$(git rev-parse --short HEAD) --name atom
# then submit to Studio with image ref: my-loan-agent:<sha>
```

**Production / CI:**
```bash
docker build -t ghcr.io/shreyasy2k/my-loan-agent:$(git rev-parse --short HEAD) .
docker push ghcr.io/shreyasy2k/my-loan-agent:$(git rev-parse --short HEAD)
# Kubernetes pulls from GHCR directly (imagePullPolicy: IfNotPresent)
```

Platform services (GATE, atom-llm, etc.) are published to `ghcr.io/shreyasy2k/atom-*:latest`
by GitHub Actions on every merge to main. No local build required for operators.

---

## 3. Runtime Request Flow

> How a request gets from an external caller to an agent pod and back.

```mermaid
sequenceDiagram
    autonumber
    participant Caller as External Caller
    participant GATE as GATE (Go)
    participant Redis as Redis
    participant OPA as OPA (in-process)
    participant PG as Postgres
    participant Agent as Agent Pod
    participant LLM as atom-llm
    participant Provider as LLM Provider
    participant Kafka as Kafka
    participant Chain as audit_log_chain

    Caller->>GATE: POST /domain/{did}/agent/{aid}/run<br/>Authorization: Bearer {caller-jwt}

    GATE->>GATE: RS256 verify JWT signature
    GATE->>GATE: Check exp, iss, sub

    GATE->>Redis: GET token_revoked:{token_hash}
    alt token is revoked
        Redis-->>GATE: "1"
        GATE-->>Caller: 401 { error: token_revoked }
    end
    Redis-->>GATE: nil (not revoked)

    GATE->>Redis: ZADD + ZCOUNT rate:{sub} sliding window
    alt rate limit hit
        GATE-->>Caller: 429 { error: rate_limit, retry_after: 1 }
    end

    GATE->>OPA: input = {<br/>  token: claims,<br/>  request: { method, path, headers },<br/>  agent: { tools, skills } ← from Redis cache<br/>}
    OPA->>OPA: eval data.atom.authz.allow
    alt policy denies
        OPA-->>GATE: { allow: false, reason: cross_domain_access }
        GATE-->>Caller: 403 { error: policy_denied, reason: ... }
    end
    OPA-->>GATE: { allow: true }

    GATE->>Redis: GET routing:{agent_id}
    alt cache miss
        Redis-->>GATE: nil
        GATE->>PG: SELECT cluster_service_name,status FROM agents WHERE id={aid}
        PG-->>GATE: agent-{id}.atom-agents.svc.cluster.local:8080
        GATE->>Redis: SETEX routing:{agent_id} 60 {service_name}
    end
    Redis-->>GATE: agent-{id}.atom-agents.svc.cluster.local:8080

    GATE->>Agent: Proxy POST /run<br/>+ headers: X-ATOM-Domain-ID, X-ATOM-Agent-ID

    Note over Agent: Agent processes request,<br/>needs to call LLM
    Agent->>GATE: POST /domain/{did}/agent/{aid}/v1/chat/completions<br/>Authorization: Bearer {agent-jwt}
    Note over GATE: Agent calling its own endpoint<br/>GATE validates agent JWT again (full chain)
    GATE->>LLM: POST /chat/completions<br/>+ metadata: { atom_agent_id }
    LLM->>Provider: POST /chat/completions (OpenAI/Azure/etc)
    Provider-->>LLM: { choices: [...] }
    LLM-->>GATE: LLM response
    LLM-)Kafka: Produce atom.llm { agent_id, model,<br/>prompt_tokens, completion_tokens, latency_ms }
    GATE-->>Agent: LLM response

    Agent-->>GATE: Final agent response

    GATE-->>Caller: 200 OK { response }

    par Async audit (non-blocking)
        GATE-)Chain: INSERT audit_log_chain<br/>{ seq, prev_hash, event, hmac }
        GATE-)Kafka: Produce atom.audit event
    end
```

---

## 4. Agent Creation Flow

> How an agent goes from idea to a JWT-holding identity in the system.

```mermaid
sequenceDiagram
    autonumber
    participant Dev as Developer
    participant UI as atom-studio UI
    participant API as atom-studio API
    participant LLM as atom-llm
    participant PG as Postgres
    participant CLI as atom-cli
    participant FS as Local Filesystem

    Dev->>UI: Open New Agent wizard
    UI->>API: GET /api/domains
    API->>PG: SELECT domains WHERE owner_id=user
    PG-->>API: domains list
    UI-->>Dev: wizard step 1: name, domain

    Dev->>UI: Fill all wizard steps:<br/>name, domain, tools, skills,<br/>memory config, policies

    Dev->>UI: Click Create Agent
    API->>PG: INSERT agents<br/>{ domain_id, name, status=draft }
    PG-->>API: agent { id }

    API->>LLM: POST /atom/provision_agent<br/>{ agent_id, allowed_models, rpm_limit, tpm_limit }
    LLM->>PG: INSERT litellm virtual key record
    LLM-->>API: { virtual_key: "sk-atom-{uuid}" }

    API->>API: AES-GCM encrypt virtual_key<br/>using ATOM_ENCRYPTION_KEY
    API->>PG: UPDATE agents SET litellm_virtual_key=encrypted_blob

    API->>API: Sign RS256 agent JWT:<br/>{ sub: agent-{id}, type: agent,<br/>  domain_id, agent_id, iss: atom-studio }
    API->>PG: INSERT agent_tokens<br/>{ agent_id, token_hash=sha256(jwt) }

    API->>PG: INSERT agent_tools (junction)
    API->>PG: INSERT agent_skills (junction)
    API->>PG: INSERT agent_policies (junction)

    API-->>UI: { agent, raw_token: "eyJ..." }
    Note over UI: raw_token shown ONCE only<br/>never stored or retrievable again
    UI-->>Dev: Token modal: "Copy and run atom create agent <token>"

    Dev->>CLI: atom create agent eyJ...
    CLI->>CLI: Decode JWT, extract agent_id, domain_id
    CLI->>API: GET /api/domains/{did}/agents/{aid}<br/>Authorization: Bearer {agent-jwt}
    API->>PG: SELECT agents + tools + skills + memory_config
    PG-->>API: full agent configuration
    API-->>CLI: { agent, domain, tools, skills, model }

    CLI->>FS: Scaffold project directory:<br/>atom_agent.yaml (agent_id, domain_id, model, tools)<br/>agent.py (entry point using atom-sdk)<br/>requirements.txt (atom-sdk + deps)<br/>.env (ATOM_AGENT_JWT=... ATOM_GATE_URL=...)<br/>Dockerfile (python:3.11-slim base)<br/>README.md

    CLI-->>Dev: Project ready at ./my-agent/<br/>Run: cd my-agent && atom validate
```

---

## 5. HITL Decision Flow

> How an agent pauses mid-execution for a human decision and resumes.

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Agent Code (atom-sdk)
    participant SDK as HITL module
    participant GATE as GATE
    participant API as atom-studio API
    participant PG as Postgres
    participant WS as WebSocket
    participant UI as Studio UI
    participant Human as Human Reviewer
    participant Chain as audit_log_chain

    Agent->>SDK: hitl.request(<br/>  payload={ action: approve_loan, amount: 50000 },<br/>  timeout_s=300<br/>)

    SDK->>GATE: POST /domain/{did}/agent/{aid}/hitl/request<br/>Authorization: Bearer {agent-jwt}
    GATE->>GATE: JWT validate + OPA check
    GATE->>API: POST /api/hitl/request<br/>{ agent_id, workflow_type=BUSINESS_DECISION,<br/>  payload, expires_at }

    API->>PG: INSERT hitl_workflows<br/>{ status=pending, expires_at }
    PG-->>API: { id: hitl-uuid }
    API->>WS: broadcast { type: NEW_DECISION,<br/>id, agent_name, payload, expires_at }
    API-->>GATE: { hitl_id }
    GATE-->>SDK: { hitl_id }

    WS->>UI: Push notification (badge + 1 in nav)

    loop Poll every 5s until decision or timeout
        SDK->>GATE: GET /domain/{did}/agent/{aid}/hitl/{id}/status
        GATE->>API: GET /api/hitl/{id}
        API->>PG: SELECT status FROM hitl_workflows WHERE id={id}
        PG-->>API: { status: pending }
        API-->>SDK: { status: pending }
    end

    Human->>UI: Open HITL queue
    UI->>API: GET /api/hitl/queue
    API-->>UI: [ { id, agent, payload, expires_at } ]
    Human->>UI: Click decision row — review payload
    Human->>UI: Click Approve + enter note
    UI->>API: POST /api/hitl/{id}/decide<br/>{ approved: true, note: "Verified by risk analyst" }
    API->>PG: UPDATE hitl_workflows SET<br/>status=approved, decided_by, decided_at, decision_note
    API->>Chain: INSERT audit_log_chain<br/>{ event: HITL_DECISION, hitl_id, approved, decided_by }
    API->>WS: broadcast { type: DECISION_MADE, hitl_id, approved: true }
    API-->>UI: 200 OK

    SDK->>GATE: GET /hitl/{id}/status (next poll)
    GATE->>API: GET /api/hitl/{id}
    API->>PG: SELECT status
    PG-->>API: { status: approved, note: "Verified by risk analyst" }
    API-->>SDK: { status: approved, note: ... }

    SDK-->>Agent: { approved: true, note: "Verified by risk analyst" }
    Agent->>Agent: Continue — execute loan approval
```

### Timeout Behaviour

```mermaid
flowchart LR
    EXP["expires_at reached\n(background task)"] --> CHK{"hitl_fallback\nconfigured on agent"}
    CHK -->|ABORT| ERR["raise TimeoutError\nagent stops"]
    CHK -->|CONTINUE| CONT["resume with\napproved=false payload"]
    CHK -->|ESCALATE| ESC["create new HITL\nassigned to admin\n+ alert"]
```

---

## 6. Audit Chain Flow

> How every GATE request becomes a tamper-evident log entry.

```mermaid
flowchart TD
    REQ["Inbound request\nto GATE"] --> PROCESS["GATE processes request\n(JWT + OPA + proxy)"]
    PROCESS --> RESPONSE["Return response\nto caller"]
    PROCESS --> ASYNC["Async goroutine pool\n(size 8, non-blocking)"]

    ASYNC --> BUILD["Build event JSON:\n{ timestamp, domain_id, agent_id,\n  caller_token_hash, method, path,\n  policy_decision, status_code, latency_ms }"]

    BUILD --> PREV["SELECT event FROM audit_log_chain\nWHERE seq = MAX(seq)\n(read last entry)"]

    PREV --> HASH["prev_hash = sha256(last_entry.event)"]
    HASH --> HMAC_CALC["hmac = hmac-sha256(\n  PLATFORM_HMAC_SECRET,\n  prev_hash || event_json\n)"]

    HMAC_CALC --> INSERT["INSERT audit_log_chain\n{ seq (bigserial), prev_hash,\n  event, hmac, created_at }"]
    HMAC_CALC --> KAFKA["Produce atom.audit\n(Kafka, key=agent_id)"]

    INSERT --> PG[(Postgres\naudit_log_chain)]
    KAFKA --> REDPANDA[(Redpanda\natom.audit topic)]
    REDPANDA --> ARCHIVER["log-archiver service\n(batches 100 msgs or 30s)"]
    ARCHIVER --> MINIO[(MinIO\natom-audit/atom.audit/\nyyyy/mm/dd/batch.jsonl)]

    PG --> VALIDATOR["Audit Validator\n(Studio background job + on-demand)"]
    VALIDATOR --> WALK["Walk entries by seq\nrecompute prev_hash + hmac\nfor each entry"]
    WALK --> VALID{"All match?"}
    VALID -->|yes| OK["Chain valid ✓\n(shown in Studio audit page)"]
    VALID -->|no| BREACH["Chain broken at seq=N\nAlert platform admin"]
```

---

## 7. Memory Access Flow

> How agent memory is stored and retrieved during execution.

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Agent Code
    participant SDK as atom-sdk MemoryManager
    participant GATE as GATE
    participant MEM as atom-memory
    participant PG as Postgres / pgvector
    participant Redis as Redis
    participant LLM as atom-llm (embeddings)

    Note over Agent: Before LLM call — inject memories

    Agent->>SDK: memory.recall("credit limit customer 4821")

    SDK->>GATE: POST /domain/{did}/agent/{aid}/memory/recall<br/>{ query: "credit limit customer 4821", top_k: 5 }
    GATE->>MEM: Forward recall request

    MEM->>GATE: POST /v1/embeddings (to get query embedding)
    GATE->>LLM: POST /embeddings { input: query, model: text-embedding-3-small }
    LLM-->>GATE: { embedding: [0.12, -0.34, ...] }  # 1536 dims
    GATE-->>MEM: embedding vector

    MEM->>PG: SELECT content, metadata,\n1 - (embedding <=> query_vec) AS similarity\nFROM memory_vectors\nWHERE agent_id = {aid}\nORDER BY embedding <=> query_vec\nLIMIT 5
    PG-->>MEM: top 5 memories with similarity scores

    MEM-->>GATE: [ { content, similarity, metadata } ]
    GATE-->>SDK: memories
    SDK-->>Agent: [ { content, similarity } ]

    Agent->>Agent: Inject top memories into system prompt\nbefore LLM call

    Note over Agent: After interaction — store new memory

    Agent->>SDK: memory.remember("Customer 4821 credit limit is 75000")

    SDK->>GATE: POST /memory/store\n{ content: "Customer 4821 credit limit is 75000" }
    GATE->>MEM: Forward store request

    MEM->>GATE: POST /v1/embeddings (embed the content)
    GATE->>LLM: POST /embeddings { input: content }
    LLM-->>MEM: embedding vector

    MEM->>PG: INSERT memory_vectors\n{ agent_id, content, embedding, metadata, created_at }
    PG-->>MEM: inserted ✓
    MEM-->>Agent: stored ✓

    Note over Agent: Short-term working memory (Redis)

    Agent->>SDK: memory.set("current_session_customer_id", "4821", ttl=3600)
    SDK->>GATE: POST /memory/set { key, value, ttl }
    GATE->>MEM: Forward
    MEM->>Redis: SETEX atom:memory:{agent_id}:current_session_customer_id 3600 "4821"
    Redis-->>Agent: ✓

    Agent->>SDK: memory.get("current_session_customer_id")
    SDK->>GATE: GET /memory/get?key=current_session_customer_id
    GATE->>MEM: Forward
    MEM->>Redis: GET atom:memory:{agent_id}:current_session_customer_id
    Redis-->>Agent: "4821"
```

---

## 8. Token Lifecycle & Revocation

> How agent tokens are issued, used, and revoked.

```mermaid
flowchart TD
    CREATE["atom-studio creates agent"] --> SIGN["Sign RS256 JWT:\n{ sub: agent-{id}, type: agent,\n  domain_id, agent_id, iss }"]
    SIGN --> HASH_T["sha256(raw_token) → token_hash"]
    HASH_T --> STORE["INSERT agent_tokens\n{ agent_id, token_hash,\n  issued_at, expires_at=null }"]
    SIGN --> DISPLAY["Show token ONCE in UI\nnever stored again\ncopy and use with atom-cli"]

    DISPLAY --> AGENT["Agent pod carries JWT\nin ATOM_AGENT_JWT env var\n(from k8s Secret)"]

    AGENT --> GATE_CHECK["Every GATE request:\n1. RS256 verify signature\n2. Check exp\n3. Redis GET token_revoked:{hash}"]

    GATE_CHECK -->|not revoked| ALLOWED["Request proceeds"]
    GATE_CHECK -->|revoked flag set| DENIED["401 token_revoked"]

    REVOKE_UI["Admin clicks Revoke in Studio\nor token regeneration"] --> REVOKE_DB["UPDATE agent_tokens\nSET revoked_at=now()\nrevoked_by=user_id"]
    REVOKE_DB --> REVOKE_REDIS["SET token_revoked:{hash} 1\nEX 86400 in Redis\n(propagates to GATE within ms)"]
    REVOKE_REDIS --> SCALE_DOWN["Scale agent Deployment to 0\nuntil redeployed with new token"]
```

---

## 9. Policy Evaluation Flow

> How OPA evaluates a policy inside GATE.

```mermaid
flowchart TD
    REQ["Incoming request\n+ JWT claims"] --> BUILD_INPUT["Build OPA input:\n{ token: claims,\n  request: { method, path },\n  agent: { tools, skills } }"]

    BUILD_INPUT --> EVAL["OPA PrepareForEval\nquery: data.atom.authz.allow\n(in-process, <1ms)"]

    EVAL --> RULES{"Evaluate Rego rules"}

    RULES --> R1["agent_auth.rego\nIs token type=agent?\nDoes agent_id match path?"]
    RULES --> R2["domain_isolation.rego\nDoes token.domain_id\nmatch path domain_id?"]
    RULES --> R3["tool_access.rego\nIs requested tool in\nagent.tools list?"]
    RULES --> R4["PLACEHOLDER_bfsi.rego\ncompliant := true\n(future PCI/SOC2 rules)"]

    R1 --> COMBINE{"All allow=true?"}
    R2 --> COMBINE
    R3 --> COMBINE
    R4 --> COMBINE

    COMBINE -->|yes| ALLOW["allow: true\nproceed to proxy"]
    COMBINE -->|no| DENY["allow: false\nreason: first deny reason\n→ 403 Forbidden"]

    ALLOW --> AUDIT_OK["Append to audit chain:\npolicy_decision: allow"]
    DENY --> AUDIT_DENY["Append to audit chain:\npolicy_decision: deny + reason"]

    HOTRELOAD["policies/ file change\n(fsnotify)"] -->|reload| EVAL
```

---

## Summary: Who Knows What

| Component | What it knows / controls |
|---|---|
| **atom-studio** | Users, domains, agents, tokens, HITL queue, deployment approvals, run history |
| **GATE** | JWT validation, OPA policy, routing table (from PG+Redis cache), audit chain |
| **OPA** | Which agents are allowed to call which resources (in-process, hot-reload) |
| **atom-llm** | Which virtual key maps to which agent; model routing; LiteLLM config |
| **atom-runtime** | How to build k8s manifests; which image to deploy; RBAC for atom-agents ns |
| **atom-memory** | Python library (not a pod) — pgvector long-term + Redis short-term per agent |
| **atom-sdk** | How agents call GATE; how to request HITL; AtomChatModel; memory injection |
| **Container Registry** | Built agent Docker images (GHCR for platform services, any OCI for agents) |
| **Postgres** | Source of truth: users, domains, agents, tokens, deployments, audit chain |
| **Redis** | Fast cache for GATE: rate counters, token revocation blacklist, routing cache |
| **Kafka (Redpanda)** | Ordered event stream: audit, LLM calls, agent logs, deployments |
| **MinIO** | Long-term audit archive; S3-compatible; batched by log-archiver service |
| **Grafana Alloy** | OTLP receiver (traces → Tempo) + k8s log collector (logs → Loki) |
| **Grafana Loki** | Log aggregation and query backend |
| **Grafana Tempo** | Distributed trace storage; TraceQL metrics (local-blocks, no Prometheus) |
| **Grafana** | Unified observability dashboards (GATE, LLM usage, audit chain, agent activity) |
