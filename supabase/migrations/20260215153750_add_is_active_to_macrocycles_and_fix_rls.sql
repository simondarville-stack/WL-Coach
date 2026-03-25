/*
  # Add is_active column to macrocycles and fix RLS policies

  1. Changes
    - Add `is_active` column to `macrocycles` table with default value true
    - Update RLS policies for `training_log_sessions` to allow anonymous access
    - Update RLS policies for `training_log_exercises` to allow anonymous access
  
  2. Security
    - In prototype mode (no authentication enforced yet)
    - All tables now allow anonymous read and write access
    - Will be tightened once authentication is implemented
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'macrocycles' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE macrocycles ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

DROP POLICY IF EXISTS "Authenticated users can read all training log sessions" ON training_log_sessions;
DROP POLICY IF EXISTS "Authenticated users can insert training log sessions" ON training_log_sessions;
DROP POLICY IF EXISTS "Authenticated users can update training log sessions" ON training_log_sessions;
DROP POLICY IF EXISTS "Authenticated users can delete training log sessions" ON training_log_sessions;

CREATE POLICY "Anyone can read training log sessions"
  ON training_log_sessions FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert training log sessions"
  ON training_log_sessions FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update training log sessions"
  ON training_log_sessions FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete training log sessions"
  ON training_log_sessions FOR DELETE
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can read training log exercises" ON training_log_exercises;
DROP POLICY IF EXISTS "Authenticated users can insert training log exercises" ON training_log_exercises;
DROP POLICY IF EXISTS "Authenticated users can update training log exercises" ON training_log_exercises;
DROP POLICY IF EXISTS "Authenticated users can delete training log exercises" ON training_log_exercises;

CREATE POLICY "Anyone can read training log exercises"
  ON training_log_exercises FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Anyone can insert training log exercises"
  ON training_log_exercises FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Anyone can update training log exercises"
  ON training_log_exercises FOR UPDATE
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete training log exercises"
  ON training_log_exercises FOR DELETE
  TO anon, authenticated
  USING (true);
