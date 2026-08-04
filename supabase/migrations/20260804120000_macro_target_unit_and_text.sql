-- Let a macro exercise column be written in kilograms, percentages, or free text.
--
-- Until now a macro target cell was a bare number and "kg" was implicit in
-- fourteen readers. A coach who programmes in percentages had nowhere to put
-- them: MacroExcelIO's "import as %" wrote the raw percentage into target_max,
-- where every consumer then treated 80 % as 80 kg.
--
-- THE UNIT LIVES ON THE COLUMN, not the cell. That mirrors the weekly planner,
-- where `planned_exercises.unit` gives one exercise one unit, and it is what
-- keeps the aggregates honest: a column's Ø and peak are computed within a
-- single unit, never across a mixture.
--
-- A percentage STAYS a percentage. There is no read-time conversion and no
-- anchor to resolve against, so nothing silently reinterprets a number. Turning
-- a %-written column into kilograms is a deliberate coach action that reuses
-- the planner's resolve flow (suggests the athlete's PR, overridable).
--
-- NULL means 'absolute_kg', so all 380 existing target rows keep their current
-- meaning and there is nothing to backfill.
ALTER TABLE public.macro_tracked_exercises
  ADD COLUMN IF NOT EXISTS target_unit text
    CHECK (target_unit IN ('absolute_kg', 'percentage', 'free_text_reps'));

COMMENT ON COLUMN public.macro_tracked_exercises.target_unit IS
  'Unit for this exercise column''s targets. NULL = absolute_kg. Values match exercises.default_unit / planned_exercises.unit.';

-- The prose value of a free-text cell ("Heavy", "Max out", "AMRAP"). The
-- numeric target_reps_at_max / target_sets_at_max stay numeric alongside it, so
-- "Heavy × 3 × 2" still renders in the stacked notation.
ALTER TABLE public.macro_targets
  ADD COLUMN IF NOT EXISTS target_text text;

COMMENT ON COLUMN public.macro_targets.target_text IS
  'Free-text load for a column whose target_unit is free_text_reps. Null for numeric columns.';
