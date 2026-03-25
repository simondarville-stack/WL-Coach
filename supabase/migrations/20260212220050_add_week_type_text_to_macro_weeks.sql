/*
  # Add week_type_text field to macro_weeks table

  1. Changes
    - Add `week_type_text` (text) column to `macro_weeks` table
    - This replaces the constrained week_type dropdown with a free text field
    - Default value is 'Medium' for compatibility

  2. Notes
    - Existing week_type column remains for backwards compatibility
    - New UI will use week_type_text for editing
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'macro_weeks' AND column_name = 'week_type_text'
  ) THEN
    ALTER TABLE macro_weeks ADD COLUMN week_type_text text DEFAULT 'Medium';
  END IF;
END $$;
