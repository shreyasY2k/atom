-- 000013: add event_raw to preserve original JSON bytes for HMAC verification.
--
-- The GATE computes HMAC over json.Marshal bytes (Go struct-field order).
-- Postgres normalises JSONB to alphabetical key order on read, so re-computing
-- HMAC from the JSONB column always produces a mismatch.  Storing the raw bytes
-- in a TEXT column lets the verifier use the exact bytes that were signed.
-- Old rows cannot be verified (event_raw = ''); new rows will pass.

ALTER TABLE audit_log_chain
  ADD COLUMN IF NOT EXISTS event_raw TEXT NOT NULL DEFAULT '';
