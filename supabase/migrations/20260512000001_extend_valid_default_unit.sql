-- Extend the valid_default_unit CHECK to include the free-text variants.
--
-- The original constraint (set in 20260211, narrowed in 20260211214504)
-- only allows ('percentage', 'absolute_kg', 'rpe', 'other'), but the
-- application has long supported two more units:
--   - free_text       — plain text prescription (no reps/sets parsing)
--   - free_text_reps  — text load × reps × sets (parsed differently)
-- Picking either from /newexercise hits a CHECK violation. Bring the
-- DB in line with the TypeScript DefaultUnit type and the parser
-- branches in the app.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_default_unit'
  ) THEN
    ALTER TABLE exercises DROP CONSTRAINT valid_default_unit;
  END IF;
END $$;

ALTER TABLE exercises ADD CONSTRAINT valid_default_unit CHECK (
  default_unit IN ('percentage', 'absolute_kg', 'rpe', 'free_text', 'free_text_reps', 'other')
);
