# SESSION-02 — Database Schema

**Prerequisites:** SESSION-01 complete (Postgres running)  
**Goal:** Design and apply the full ATOM Postgres schema with migrations.  
**Estimated time:** 0.5 days

---

## Tables

### `users`
```sql
id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
email         text UNIQUE NOT NULL
password_hash text NOT NULL
full_name     text
role          text NOT NULL DEFAULT 'developer'  -- 'admin' | 'developer'
is_active     boolean NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()
updated_at    timestamptz NOT NULL DEFAULT now()
```

### `domains`
```sql
id           uuid PRIMARY KEY DEFAULT uuid_generate_v4()
name         text UNIQUE NOT NULL
description  text
owner_id     uuid REFERENCES users(id)
is_active    boolean NOT NULL DEFAULT true
created_at   timestamptz NOT NULL DEFAULT now()
```

### `agents`
```sql
id                   uuid PRIMARY KEY DEFAULT uuid_generate_v4()
domain_id            uuid NOT NULL REFERENCES domains(id)
owner_id             uuid NOT NULL REFERENCES users(id)
name                 text NOT NULL
description          text
status               text NOT NULL DEFAULT 'draft'
  -- 'draft' | 'pending_approval' | 'deployed' | 'suspended'
cluster_service_name text   -- e.g. agent-{id}.atom-agents.svc.cluster.local
litellm_virtual_key  text   -- encrypted
memory_config_id     uuid REFERENCES memory_configs(id)
hitl_timeout_seconds int    NOT NULL DEFAULT 300
hitl_fallback        text   NOT NULL DEFAULT 'ABORT'
  -- 'ABORT' | 'CONTINUE' | 'ESCALATE'
created_at           timestamptz NOT NULL DEFAULT now()
updated_at           timestamptz NOT NULL DEFAULT now()
UNIQUE(domain_id, name)
```

### `agent_tokens`
```sql
id           uuid PRIMARY KEY DEFAULT uuid_generate_v4()
agent_id     uuid NOT NULL REFERENCES agents(id)
token_hash   text NOT NULL  -- sha256 of the raw JWT for revocation lookup
issued_at    timestamptz NOT NULL DEFAULT now()
expires_at   timestamptz    -- null = no expiry
revoked_at   timestamptz
revoked_by   uuid REFERENCES users(id)
```

### `policies`
```sql
id          uuid PRIMARY KEY DEFAULT uuid_generate_v4()
name        text UNIQUE NOT NULL
description text
rego_path   text NOT NULL   -- path in policies/ directory
applies_to  text NOT NULL DEFAULT 'all'  -- 'all' | 'domain' | 'agent'
is_active   boolean NOT NULL DEFAULT true
created_at  timestamptz NOT NULL DEFAULT now()
```

### `agent_policies`  *(many-to-many)*
```sql
agent_id   uuid NOT NULL REFERENCES agents(id)
policy_id  uuid NOT NULL REFERENCES policies(id)
PRIMARY KEY (agent_id, policy_id)
```

### `tools`
```sql
id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
name          text UNIQUE NOT NULL
description   text
endpoint      text NOT NULL   -- internal cluster URL
schema_json   jsonb           -- JSON Schema for input validation
is_active     boolean NOT NULL DEFAULT true
created_at    timestamptz NOT NULL DEFAULT now()
```

### `agent_tools`  *(many-to-many)*
```sql
agent_id  uuid NOT NULL REFERENCES agents(id)
tool_id   uuid NOT NULL REFERENCES tools(id)
PRIMARY KEY (agent_id, tool_id)
```

### `skills`
```sql
id           uuid PRIMARY KEY DEFAULT uuid_generate_v4()
name         text UNIQUE NOT NULL
description  text
pip_package  text    -- python package providing the skill
is_active    boolean NOT NULL DEFAULT true
created_at   timestamptz NOT NULL DEFAULT now()
```

### `agent_skills`  *(many-to-many)*
```sql
agent_id  uuid NOT NULL REFERENCES agents(id)
skill_id  uuid NOT NULL REFERENCES skills(id)
PRIMARY KEY (agent_id, skill_id)
```

### `memory_configs`
```sql
id               uuid PRIMARY KEY DEFAULT uuid_generate_v4()
short_term_type  text NOT NULL DEFAULT 'redis'
short_term_ttl_s int  NOT NULL DEFAULT 3600
long_term_type   text NOT NULL DEFAULT 'pgvector'
max_vectors      int  NOT NULL DEFAULT 100000
embedding_model  text NOT NULL DEFAULT 'text-embedding-3-small'
created_at       timestamptz NOT NULL DEFAULT now()
```

### `audit_log_chain`
```sql
id          uuid PRIMARY KEY DEFAULT uuid_generate_v4()
seq         bigserial UNIQUE NOT NULL   -- monotonic order
prev_hash   text NOT NULL               -- sha256 of previous entry ('genesis' for first)
event       jsonb NOT NULL              -- full event payload
hmac        text NOT NULL               -- hmac-sha256(secret, prev_hash || event::text)
created_at  timestamptz NOT NULL DEFAULT now()
```

### `deployments`
```sql
id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
agent_id      uuid NOT NULL REFERENCES agents(id)
version       int  NOT NULL DEFAULT 1
status        text NOT NULL DEFAULT 'pending'
  -- 'pending' | 'approved' | 'rejected' | 'deployed' | 'failed' | 'rolled_back'
submitted_by  uuid NOT NULL REFERENCES users(id)
approved_by   uuid REFERENCES users(id)
manifest_json jsonb       -- k8s manifest snapshot
deployed_at   timestamptz
created_at    timestamptz NOT NULL DEFAULT now()
```

### `hitl_workflows`
```sql
id            uuid PRIMARY KEY DEFAULT uuid_generate_v4()
agent_id      uuid NOT NULL REFERENCES agents(id)
workflow_type text NOT NULL     -- 'BUSINESS_DECISION' | 'DEPLOYMENT_APPROVAL'
payload       jsonb NOT NULL
status        text NOT NULL DEFAULT 'pending'
  -- 'pending' | 'approved' | 'rejected' | 'timed_out'
assigned_to   uuid REFERENCES users(id)
decided_by    uuid REFERENCES users(id)
decision_note text
expires_at    timestamptz
created_at    timestamptz NOT NULL DEFAULT now()
decided_at    timestamptz
```

### `memory_vectors`  *(pgvector)*
```sql
id         uuid PRIMARY KEY DEFAULT uuid_generate_v4()
agent_id   uuid NOT NULL REFERENCES agents(id)
content    text NOT NULL
embedding  vector(1536)        -- OpenAI text-embedding-3-small dimensions
metadata   jsonb
created_at timestamptz NOT NULL DEFAULT now()
```
Index: `CREATE INDEX ON memory_vectors USING hnsw (embedding vector_cosine_ops)`

---

## Tasks

1. Install `golang-migrate` CLI: `go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest`
2. Create `migrations/` directory with numbered up/down files: `000001_init.up.sql`, `000001_init.down.sql`, etc.
3. Split schema into logical migration steps:
   - `000001_users_domains.up.sql`
   - `000002_agents_tokens.up.sql`
   - `000003_policies_tools_skills.up.sql`
   - `000004_memory_configs.up.sql`
   - `000005_audit_chain.up.sql`
   - `000006_deployments_hitl.up.sql`
   - `000007_memory_vectors.up.sql`
4. Write corresponding `.down.sql` (DROP TABLE in reverse order).
5. Add `make migrate-up` and `make migrate-down` to Makefile.
6. Create `migrations/seed_dev.sql` with sample domain, user, and agent for development.
7. Run migrations against the kind-deployed Postgres. Verify with `\d` in psql.

---

## Technologies

| Technology | Rationale |
|---|---|
| golang-migrate | Simple, no runtime dependency, supports Postgres natively, reversible |
| pgvector `vector` type | Native Postgres storage for embeddings |
| `uuid_generate_v4()` | Universally unique IDs, no sequence contention |
| HNSW index | Approximate nearest-neighbor for vector search; better recall than IVFFlat |

---

## Acceptance Criteria

- [ ] `make migrate-up` applies all 7 migration files without error.
- [ ] `make migrate-down` reverts all migrations cleanly.
- [ ] `\dt` in psql shows all 14 tables.
- [ ] `SELECT * FROM memory_vectors LIMIT 1` succeeds (uses vector extension).
- [ ] `EXPLAIN SELECT * FROM memory_vectors ORDER BY embedding <=> '[0.1,...]' LIMIT 5` uses HNSW index.
- [ ] Seed data inserts successfully.

---

## Expected Outcome

A fully defined, migration-managed database schema ready for all ATOM components to write to.

---

## Claude Code Starter Prompt

```
You are implementing SESSION-02 of ATOM — the full database schema.

Context: Postgres 16 with pgvector is running in the kind cluster (atom-infra namespace).
golang-migrate is the migration tool.

Task: Create all migration files in migrations/ directory.

Schema requirements (write separate up/down files for each):
- 000001: users, domains tables
- 000002: agents, agent_tokens tables
- 000003: policies, agent_policies, tools, agent_tools, skills, agent_skills tables
- 000004: memory_configs table
- 000005: audit_log_chain table with seq bigserial + hmac
- 000006: deployments, hitl_workflows tables
- 000007: memory_vectors table with vector(1536) type and HNSW index

Key constraints:
- All PKs use uuid DEFAULT uuid_generate_v4()
- All timestamps use timestamptz DEFAULT now()
- audit_log_chain.seq is bigserial for ordering
- memory_vectors embedding is vector(1536)
- Add HNSW index: CREATE INDEX ON memory_vectors USING hnsw (embedding vector_cosine_ops)

After writing migrations, update Makefile with:
  make migrate-up: migrate -database $DATABASE_URL -path migrations up
  make migrate-down: migrate -database $DATABASE_URL -path migrations down 1

Then run make migrate-up and verify all tables with \dt.
Also write migrations/seed_dev.sql with one admin user, one domain, and one agent record.
```

---

