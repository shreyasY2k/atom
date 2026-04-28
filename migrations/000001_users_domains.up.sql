-- 000001: users and domains

CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    email         text        UNIQUE NOT NULL,
    password_hash text        NOT NULL,
    full_name     text,
    role          text        NOT NULL DEFAULT 'developer'
                              CHECK (role IN ('admin', 'developer')),
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE domains (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        text        UNIQUE NOT NULL,
    description text,
    owner_id    uuid        REFERENCES users(id),
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_email    ON users(email);
CREATE INDEX idx_domains_owner  ON domains(owner_id);
