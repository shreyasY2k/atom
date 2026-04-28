-- 000006: deployment records and HITL workflow queue

CREATE TABLE deployments (
    id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id      uuid        NOT NULL REFERENCES agents(id),
    version       int         NOT NULL DEFAULT 1,
    status        text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected','deployed','failed','rolled_back')),
    submitted_by  uuid        NOT NULL REFERENCES users(id),
    approved_by   uuid        REFERENCES users(id),
    manifest_json jsonb,
    deployed_at   timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hitl_workflows (
    id            uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id      uuid        NOT NULL REFERENCES agents(id),
    workflow_type text        NOT NULL
                              CHECK (workflow_type IN ('BUSINESS_DECISION','DEPLOYMENT_APPROVAL')),
    payload       jsonb       NOT NULL,
    status        text        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected','timed_out')),
    assigned_to   uuid        REFERENCES users(id),
    decided_by    uuid        REFERENCES users(id),
    decision_note text,
    expires_at    timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    decided_at    timestamptz
);

CREATE INDEX idx_deployments_agent    ON deployments(agent_id);
CREATE INDEX idx_deployments_status   ON deployments(status);
CREATE INDEX idx_hitl_status          ON hitl_workflows(status);
CREATE INDEX idx_hitl_agent           ON hitl_workflows(agent_id);
CREATE INDEX idx_hitl_assigned        ON hitl_workflows(assigned_to);
