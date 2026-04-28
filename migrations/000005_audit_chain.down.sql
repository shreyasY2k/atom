-- 000005 rollback
DROP TRIGGER IF EXISTS trg_audit_log_chain_no_update ON audit_log_chain;
DROP FUNCTION IF EXISTS audit_log_chain_immutable();
DROP TABLE IF EXISTS audit_log_chain;
