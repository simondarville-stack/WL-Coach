-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A2: UF-40 (DB-04, E-OQ-03)
-- Add unique constraint on (log_exercise_id, set_number) to prevent duplicate
-- set rows from concurrent double-taps. The application-level upsertLoggedSet
-- is also converted to INSERT ... ON CONFLICT after this migration lands.

-- Rollback:
--   ALTER TABLE training_log_sets DROP CONSTRAINT IF EXISTS uq_set_number;

ALTER TABLE training_log_sets
  ADD CONSTRAINT uq_set_number UNIQUE (log_exercise_id, set_number);
