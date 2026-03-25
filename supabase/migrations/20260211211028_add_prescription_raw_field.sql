/*
  # Add prescription_raw field to planned_exercises

  1. Changes
    - Add `prescription_raw` (text, optional) to planned_exercises table
    - This stores the raw prescription string like "3x5@80, 4x3@85"
    - Used for quick entry and display in compact UI

  2. Notes
    - This field is parsed into planned_set_lines for detailed tracking
    - Summaries are computed from set lines, not from raw text
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_exercises' AND column_name = 'prescription_raw'
  ) THEN
    ALTER TABLE planned_exercises ADD COLUMN prescription_raw text;
  END IF;
END $$;
