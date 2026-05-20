-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A3: UF-43 (DC-01)
-- Add performed_text column to training_log_sets to separate the two
-- semantic roles currently conflated in the notes column:
--   notes         = athlete annotation (applies to all set types)
--   performed_text = free-text performed value (only for free_text/other units)

-- Rollback:
--   ALTER TABLE training_log_sets DROP COLUMN IF EXISTS performed_text;

ALTER TABLE training_log_sets
  ADD COLUMN IF NOT EXISTS performed_text text null;
