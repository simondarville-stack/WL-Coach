/*
  # Add use_stacked_notation to exercises table

  1. Changes
    - Add `use_stacked_notation` (boolean, default false) to `exercises` table
    - When true, exercises with units kg, %, or RPE will be rendered in stacked notation
    - Stacked notation shows load over reps with sets on the right side

  2. Notes
    - This is a display-only feature for athlete-facing and print views
    - Does not affect data storage, only rendering
    - Default is false to maintain backward compatibility with linear notation
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'use_stacked_notation'
  ) THEN
    ALTER TABLE exercises ADD COLUMN use_stacked_notation boolean DEFAULT false;
  END IF;
END $$;
