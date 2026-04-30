-- 000012: incremental run messages + run status
-- Extends agent_runs to support the agentscope tRPC push model:
-- agents can register a run (registerRun) and push messages one-by-one
-- (pushMessage) as the run progresses, before it's marked complete.

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS messages  jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS run_name  text,
  ADD COLUMN IF NOT EXISTS status    text NOT NULL DEFAULT 'complete'
    CHECK (status IN ('running', 'complete', 'error'));

-- Back-fill: existing rows are already complete
UPDATE agent_runs SET status = 'complete' WHERE status IS DISTINCT FROM 'complete';
