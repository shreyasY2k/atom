ALTER TABLE agent_tokens DROP COLUMN IF EXISTS token_type;
DROP INDEX IF EXISTS idx_agent_tokens_type;
