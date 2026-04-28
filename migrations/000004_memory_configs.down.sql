-- 000004 rollback
ALTER TABLE agents DROP CONSTRAINT IF EXISTS fk_agents_memory_config;
DROP TABLE IF EXISTS memory_configs;
