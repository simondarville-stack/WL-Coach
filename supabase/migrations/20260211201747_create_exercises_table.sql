/*
  # Create exercises table for Olympic weightlifting exercise library

  1. New Tables
    - `exercises`
      - `id` (uuid, primary key) - Unique identifier for each exercise
      - `name` (text, required) - Exercise name (e.g., "Snatch", "Back Squat")
      - `category` (text, required) - Exercise category from predefined list
      - `is_competition_lift` (boolean, default false) - Whether this is a competition lift
      - `default_unit` (text, required) - Default unit for this exercise
      - `notes` (text, optional) - Additional notes about the exercise
      - `created_at` (timestamptz) - Timestamp when exercise was created
      - `updated_at` (timestamptz) - Timestamp when exercise was last updated

  2. Security
    - Enable RLS on `exercises` table
    - Add policies for public access (no authentication required for Slice 1)
    - Anyone can read, insert, update, and delete exercises

  3. Constraints
    - Check constraints to ensure category and default_unit values are valid
*/

CREATE TABLE IF NOT EXISTS exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  is_competition_lift boolean DEFAULT false,
  default_unit text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_category CHECK (
    category IN ('Snatch', 'Clean & Jerk', 'Squat', 'Pull', 'Press', 'Accessory')
  ),
  CONSTRAINT valid_default_unit CHECK (
    default_unit IN ('percentage', 'absolute_kg', 'rpe')
  )
);

ALTER TABLE exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view exercises"
  ON exercises
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert exercises"
  ON exercises
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update exercises"
  ON exercises
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete exercises"
  ON exercises
  FOR DELETE
  USING (true);

CREATE INDEX IF NOT EXISTS idx_exercises_category ON exercises(category);
CREATE INDEX IF NOT EXISTS idx_exercises_name ON exercises(name);