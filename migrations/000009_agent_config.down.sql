-- 000009 rollback
ALTER TABLE agents DROP COLUMN IF EXISTS allowed_models;
ALTER TABLE agents DROP COLUMN IF EXISTS rpm_limit;
ALTER TABLE agents DROP COLUMN IF EXISTS tpm_limit;
