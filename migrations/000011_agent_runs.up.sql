-- 000011: agent conversation runs — tracks each /run invocation with full
-- message history so atom-studio can show a chat-style conversation view.

CREATE TABLE IF NOT EXISTS agent_runs (
    id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id    uuid NOT NULL REFERENCES agents(id),
    run_id      text NOT NULL UNIQUE,          -- external ID sent by agent
    trace_id    text,                          -- OTEL trace id for linking to Tempo
    user_msg    text NOT NULL,
    reply       text NOT NULL,
    steps       jsonb NOT NULL DEFAULT '[]',   -- thinking steps / tool calls
    latency_ms  int,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_agent_runs_agent_id ON agent_runs (agent_id, created_at DESC);
