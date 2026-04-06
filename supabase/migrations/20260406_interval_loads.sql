-- Add load_max column to planned_set_lines
-- When NULL: fixed load (current behavior, load_value is the exact weight)
-- When set: interval load (load_value = min, load_max = max)
ALTER TABLE planned_set_lines
  ADD COLUMN IF NOT EXISTS load_max decimal DEFAULT NULL;

-- Constraint: if load_max is set, it must be >= load_value
ALTER TABLE planned_set_lines
  ADD CONSTRAINT interval_range_valid
  CHECK (load_max IS NULL OR load_max >= load_value);
