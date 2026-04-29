-- 000010: distinguish pod tokens from client tokens so that regenerate-token
-- does not revoke the running pod's JWT.
ALTER TABLE agent_tokens
  ADD COLUMN IF NOT EXISTS token_type text NOT NULL DEFAULT 'client'
    CHECK (token_type IN ('client', 'pod'));

CREATE INDEX IF NOT EXISTS idx_agent_tokens_type ON agent_tokens (agent_id, token_type);
