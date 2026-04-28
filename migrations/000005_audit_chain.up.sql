-- 000005: immutable hash-chained audit log

CREATE TABLE audit_log_chain (
    id         uuid        PRIMARY KEY DEFAULT uuid_generate_v4(),
    seq        bigserial   UNIQUE NOT NULL,
    prev_hash  text        NOT NULL,
    event      jsonb       NOT NULL,
    hmac       text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enforce append-only: no updates or deletes via trigger
CREATE OR REPLACE FUNCTION audit_log_chain_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log_chain rows are immutable';
END;
$$;

CREATE TRIGGER trg_audit_log_chain_no_update
    BEFORE UPDATE OR DELETE ON audit_log_chain
    FOR EACH ROW EXECUTE FUNCTION audit_log_chain_immutable();

CREATE INDEX idx_audit_log_chain_seq ON audit_log_chain(seq);
