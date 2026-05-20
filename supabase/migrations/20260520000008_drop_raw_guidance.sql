-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A8: Q-02 (defaulted answer)
-- Drop raw_guidance from training_log_sessions. The column is present in
-- SessionPatch and database.types.ts but is never written by the current
-- code. The Eleiko guidance is now derived client-side from ELEIKO_RAW_BANDS
-- in trainingLogModel.ts.

-- Rollback:
--   ALTER TABLE training_log_sessions ADD COLUMN IF NOT EXISTS raw_guidance text null;

ALTER TABLE training_log_sessions
  DROP COLUMN IF EXISTS raw_guidance;
