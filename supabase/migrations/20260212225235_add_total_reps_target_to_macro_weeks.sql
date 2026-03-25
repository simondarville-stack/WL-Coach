/*
  # Add total reps target to macro weeks

  1. Changes
    - Add `total_reps_target` column to `macro_weeks` table
      - Stores the target total reps for the entire week
      - Nullable integer field (can be left empty if not tracking)
  
  2. Notes
    - This provides a simple weekly target that's shown by default
    - Different from per-exercise targets in macro_targets table
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'macro_weeks' AND column_name = 'total_reps_target'
  ) THEN
    ALTER TABLE macro_weeks ADD COLUMN total_reps_target integer;
  END IF;
END $$;