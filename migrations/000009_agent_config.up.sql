-- 000009: add LiteLLM rate-limit and model fields to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS allowed_models text[]  NOT NULL DEFAULT '{}';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS rpm_limit       int     NOT NULL DEFAULT 60;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tpm_limit       int     NOT NULL DEFAULT 100000;
