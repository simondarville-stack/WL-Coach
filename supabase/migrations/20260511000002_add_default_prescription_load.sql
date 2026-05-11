-- Add default_prescription_load to general_settings.
--
-- When a coach starts a fresh prescription on an empty exercise (no
-- previous columns to derive from), the grid seeds the first column's
-- load from this value. Coach-defined per environment so percentage
-- workflows can default to 50 (50% warmup baseline) and kg workflows
-- can default to whatever the coach considers a sensible starting set.

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS default_prescription_load numeric(6,2) NOT NULL DEFAULT 50;
