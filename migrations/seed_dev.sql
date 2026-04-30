-- Development seed data — run with: make seed-dev  (docker-compose)
--                          or:   make seed-k8s   (kubernetes)
-- Credentials: admin@atom.local / admin123  (dev only — change in production)
-- Hash generated with: python3 -c "import bcrypt; print(bcrypt.hashpw(b'admin123',bcrypt.gensalt(12)).decode())"

BEGIN;

INSERT INTO users (id, email, password_hash, full_name, role)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'admin@atom.local',
    '$2b$12$pV7Vy64/2t6o9cSHEb1UkeAeJVTckMNaDPngUEeQyCTLG.8LIQQcy',
    'ATOM Admin',
    'admin'
)
ON CONFLICT (id) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    is_active     = true;

INSERT INTO domains (id, name, description, owner_id)
VALUES (
    '00000000-0000-0000-0000-000000000010',
    'default',
    'Default development domain',
    '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO memory_configs (id, short_term_type, long_term_type, embedding_model)
VALUES (
    '00000000-0000-0000-0000-000000000020',
    'redis',
    'pgvector',
    'text-embedding-3-small'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agents (id, domain_id, owner_id, name, description, status, memory_config_id, litellm_virtual_key)
VALUES (
    '00000000-0000-0000-0000-000000000100',
    '00000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000001',
    'dev-agent',
    'Development test agent',
    'draft',
    '00000000-0000-0000-0000-000000000020',
    'sk-atom-dev'   -- matches LITELLM_MASTER_KEY in dev; replaced by provision_agent in production
)
ON CONFLICT (id) DO UPDATE SET litellm_virtual_key = EXCLUDED.litellm_virtual_key;

COMMIT;
