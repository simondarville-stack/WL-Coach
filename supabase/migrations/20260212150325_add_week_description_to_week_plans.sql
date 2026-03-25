/*
  # Add week description to week plans

  1. Changes
    - Add `week_description` TEXT column to `week_plans` table
      - Stores coach's notes/description for the week
      - Nullable to allow empty descriptions
      - Displayed in weekly planner and print view
    
  2. Notes
    - This allows coaches to add context, focus, or notes for the training week
    - Will be displayed between summaries and daily programming in print view
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'week_plans' AND column_name = 'week_description'
  ) THEN
    ALTER TABLE week_plans ADD COLUMN week_description TEXT;
  END IF;
END $$;