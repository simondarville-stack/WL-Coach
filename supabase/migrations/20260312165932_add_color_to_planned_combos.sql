/*
  # Add color field to planned_combos

  1. Changes
    - Add `color` column to `planned_combos` table (text, default '#3B82F6' - blue)

  2. Notes
    - Default color is blue (#3B82F6) which matches existing UI
    - Color can be customized when creating combos
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_combos' AND column_name = 'color'
  ) THEN
    ALTER TABLE planned_combos ADD COLUMN color text DEFAULT '#3B82F6';
  END IF;
END $$;
