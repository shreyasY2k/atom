-- 000014: add dir and builtin columns to skills table (SESSION-18)
ALTER TABLE skills
    ADD COLUMN IF NOT EXISTS dir     text,
    ADD COLUMN IF NOT EXISTS builtin boolean NOT NULL DEFAULT false;
