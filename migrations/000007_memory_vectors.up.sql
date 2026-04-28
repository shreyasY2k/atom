-- 000007: vector memory store (requires pgvector extension)

CREATE TABLE memory_vectors (
    id         uuid         PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id   uuid         NOT NULL REFERENCES agents(id),
    content    text         NOT NULL,
    embedding  vector(1536),
    metadata   jsonb,
    created_at timestamptz  NOT NULL DEFAULT now()
);

-- HNSW index for fast approximate cosine-similarity search
CREATE INDEX idx_memory_vectors_hnsw
    ON memory_vectors
    USING hnsw (embedding vector_cosine_ops);

CREATE INDEX idx_memory_vectors_agent ON memory_vectors(agent_id);
