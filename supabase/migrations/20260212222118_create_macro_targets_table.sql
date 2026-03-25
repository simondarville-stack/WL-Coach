/*
  # Create macro targets table

  1. New Tables
    - `macro_targets`
      - `id` (uuid, primary key)
      - `macro_week_id` (uuid, foreign key to macro_weeks)
      - `tracked_exercise_id` (uuid, foreign key to macro_tracked_exercises)
      - `target_reps` (integer, nullable) - Target number of reps
      - `target_ave` (numeric, nullable) - Target average weight
      - `target_hi` (numeric, nullable) - Target high weight
      - `target_rhi` (integer, nullable) - Target reps at high weight
      - `target_shi` (integer, nullable) - Target sets at high weight
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `macro_targets` table
    - Add policy for anonymous users to read all targets
    - Add policy for anonymous users to insert targets
    - Add policy for anonymous users to update targets
    - Add policy for anonymous users to delete targets

  3. Indexes
    - Add unique constraint on (macro_week_id, tracked_exercise_id)
    - Add index on macro_week_id for faster lookups
    - Add index on tracked_exercise_id for faster lookups
*/

CREATE TABLE IF NOT EXISTS macro_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  macro_week_id uuid NOT NULL REFERENCES macro_weeks(id) ON DELETE CASCADE,
  tracked_exercise_id uuid NOT NULL REFERENCES macro_tracked_exercises(id) ON DELETE CASCADE,
  target_reps integer,
  target_ave numeric(10,2),
  target_hi numeric(10,2),
  target_rhi integer,
  target_shi integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(macro_week_id, tracked_exercise_id)
);

CREATE INDEX IF NOT EXISTS idx_macro_targets_week ON macro_targets(macro_week_id);
CREATE INDEX IF NOT EXISTS idx_macro_targets_exercise ON macro_targets(tracked_exercise_id);

ALTER TABLE macro_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous read access to macro_targets"
  ON macro_targets FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Allow anonymous insert access to macro_targets"
  ON macro_targets FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Allow anonymous update access to macro_targets"
  ON macro_targets FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow anonymous delete access to macro_targets"
  ON macro_targets FOR DELETE
  TO anon
  USING (true);