-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A1: UF-39 (DD-02, DD-03)
-- Add indexes on the two highest-volume child tables to eliminate sequential
-- scans on every fetchWeekLog / fetchSessionForSlot call.

-- Rollback:
--   DROP INDEX IF EXISTS idx_training_log_sets_log_exercise;
--   DROP INDEX IF EXISTS idx_training_log_messages_session;

CREATE INDEX IF NOT EXISTS idx_training_log_sets_log_exercise
  ON training_log_sets (log_exercise_id);

CREATE INDEX IF NOT EXISTS idx_training_log_messages_session
  ON training_log_messages (session_id);
