/*
  # Add color field to exercises table

  1. Changes
    - Add `color` (text, optional) to exercises table
    - Stores hex color codes like "#3B82F6" for displaying exercises in the weekly planner
    - Default colors can be blue, green, red, purple, orange, etc.

  2. Notes
    - Color is optional and defaults to a standard blue if not specified
    - Used for visual organization in the weekly overview
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'color'
  ) THEN
    ALTER TABLE exercises ADD COLUMN color text DEFAULT '#3B82F6';
  END IF;
END $$;
