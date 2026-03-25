/*
  # Create macro_tracked_exercises table

  1. New Tables
    - `macro_tracked_exercises`
      - `id` (uuid, primary key)
      - `macrocycle_id` (uuid, foreign key to macrocycles)
      - `exercise_id` (uuid, foreign key to exercises)
      - `position` (integer) - display order of tracked exercise
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `macro_tracked_exercises` table
    - Add policy for anonymous users to read all tracked exercises
    - Add policy for anonymous users to insert tracked exercises
    - Add policy for anonymous users to update tracked exercises
    - Add policy for anonymous users to delete tracked exercises

  3. Constraints
    - Unique constraint on (macrocycle_id, exercise_id) to prevent duplicates
    - Unique constraint on (macrocycle_id, position) to prevent position conflicts
*/

CREATE TABLE IF NOT EXISTS macro_tracked_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  macrocycle_id uuid NOT NULL REFERENCES macrocycles(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(macrocycle_id, exercise_id),
  UNIQUE(macrocycle_id, position)
);

ALTER TABLE macro_tracked_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to macro_tracked_exercises"
  ON macro_tracked_exercises
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous insert access to macro_tracked_exercises"
  ON macro_tracked_exercises
  FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous update access to macro_tracked_exercises"
  ON macro_tracked_exercises
  FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anonymous delete access to macro_tracked_exercises"
  ON macro_tracked_exercises
  FOR DELETE
  TO anon
  USING (true);
