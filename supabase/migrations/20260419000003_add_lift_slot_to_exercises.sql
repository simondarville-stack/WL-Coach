-- Apply with: supabase db push (user must apply)
-- Adds lift_slot to exercises for deterministic OWL category mapping.

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS lift_slot text
    CHECK (lift_slot IN ('snatch','clean_and_jerk','front_squat','back_squat','snatch_pull','clean_pull'))
    NULL;

COMMENT ON COLUMN exercises.lift_slot IS
  'Optional Olympic lift slot used by kValue.ts and analysis hooks to avoid name-matching heuristics.';
