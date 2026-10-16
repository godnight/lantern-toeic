-- A bounded per-username ticket links counter changes within one D1 batch.
-- Existing rows, counters and ownership remain intact. No request log is added.
ALTER TABLE auth_rate_limits ADD COLUMN admission_id TEXT NOT NULL DEFAULT '';
