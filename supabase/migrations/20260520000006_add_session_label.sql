-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A6: UF-37 (D-06, DG-06)
-- Add session_label to training_log_sessions so athlete-created bonus sessions
-- can carry a name independent of the week_plans.day_labels lookup.
-- The service writes label here; coach-configurable label lists are deferred
-- to Group J (domain hardcoding sprint).

-- Rollback:
--   ALTER TABLE training_log_sessions DROP COLUMN IF EXISTS session_label;

ALTER TABLE training_log_sessions
  ADD COLUMN IF NOT EXISTS session_label text null;
