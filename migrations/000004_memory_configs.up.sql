-- 000004: memory_configs, then wire the FK from agents

CREATE TABLE memory_configs (
    id               uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    short_term_type  text        NOT NULL DEFAULT 'redis',
    short_term_ttl_s int         NOT NULL DEFAULT 3600,
    long_term_type   text        NOT NULL DEFAULT 'pgvector',
    max_vectors      int         NOT NULL DEFAULT 100000,
    embedding_model  text        NOT NULL DEFAULT 'text-embedding-3-small',
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Add FK that was deferred because memory_configs didn't exist in 000002
ALTER TABLE agents
    ADD CONSTRAINT fk_agents_memory_config
    FOREIGN KEY (memory_config_id) REFERENCES memory_configs(id);
