-- 000003: policies, tools, skills and their agent join tables

CREATE TABLE policies (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        text        UNIQUE NOT NULL,
    description text,
    rego_path   text        NOT NULL,
    applies_to  text        NOT NULL DEFAULT 'all'
                            CHECK (applies_to IN ('all','domain','agent')),
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_policies (
    agent_id  uuid NOT NULL REFERENCES agents(id),
    policy_id uuid NOT NULL REFERENCES policies(id),
    PRIMARY KEY (agent_id, policy_id)
);

CREATE TABLE tools (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        text        UNIQUE NOT NULL,
    description text,
    endpoint    text        NOT NULL,
    schema_json jsonb,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_tools (
    agent_id uuid NOT NULL REFERENCES agents(id),
    tool_id  uuid NOT NULL REFERENCES tools(id),
    PRIMARY KEY (agent_id, tool_id)
);

CREATE TABLE skills (
    id          uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        text        UNIQUE NOT NULL,
    description text,
    pip_package text,
    is_active   boolean     NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE agent_skills (
    agent_id uuid NOT NULL REFERENCES agents(id),
    skill_id uuid NOT NULL REFERENCES skills(id),
    PRIMARY KEY (agent_id, skill_id)
);
