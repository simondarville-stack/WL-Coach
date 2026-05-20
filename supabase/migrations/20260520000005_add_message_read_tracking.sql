-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A5: UF-10 (D-18, E-19, Data Tension 3) — schema portion
-- Add per-role read timestamps to training_log_messages.
-- Q-06 decision: two nullable timestamp columns (single-coach model).
-- Extend to a message_receipts join table when multi-coach shared-athlete
-- becomes a near-term requirement.

-- Rollback:
--   ALTER TABLE training_log_messages DROP COLUMN IF EXISTS coach_read_at;
--   ALTER TABLE training_log_messages DROP COLUMN IF EXISTS athlete_read_at;

ALTER TABLE training_log_messages
  ADD COLUMN IF NOT EXISTS coach_read_at   timestamptz null,
  ADD COLUMN IF NOT EXISTS athlete_read_at timestamptz null;
