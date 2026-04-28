-- 000002: agents and agent_tokens
-- Note: memory_config_id FK to memory_configs is added in 000004 (after memory_configs is created)

CREATE TABLE agents (
    id                   uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain_id            uuid        NOT NULL REFERENCES domains(id),
    owner_id             uuid        NOT NULL REFERENCES users(id),
    name                 text        NOT NULL,
    description          text,
    status               text        NOT NULL DEFAULT 'draft'
                                     CHECK (status IN ('draft','pending_approval','deployed','suspended')),
    cluster_service_name text,
    litellm_virtual_key  text,
    memory_config_id     uuid,       -- FK to memory_configs added in migration 000004
    hitl_timeout_seconds int         NOT NULL DEFAULT 300,
    hitl_fallback        text        NOT NULL DEFAULT 'ABORT'
                                     CHECK (hitl_fallback IN ('ABORT','CONTINUE','ESCALATE')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (domain_id, name)
);

CREATE TABLE agent_tokens (
    id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id   uuid        NOT NULL REFERENCES agents(id),
    token_hash text        NOT NULL,
    issued_at  timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    revoked_at timestamptz,
    revoked_by uuid        REFERENCES users(id)
);

CREATE INDEX idx_agents_domain     ON agents(domain_id);
CREATE INDEX idx_agents_status     ON agents(status);
CREATE INDEX idx_agent_tokens_hash ON agent_tokens(token_hash);
