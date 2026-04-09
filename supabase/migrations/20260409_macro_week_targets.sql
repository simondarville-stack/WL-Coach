-- Add tonnage_target and avg_intensity_target to macro_weeks
-- These are plan targets set manually by the coach (kg values)
ALTER TABLE macro_weeks
  ADD COLUMN IF NOT EXISTS tonnage_target NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS avg_intensity_target NUMERIC DEFAULT NULL;
