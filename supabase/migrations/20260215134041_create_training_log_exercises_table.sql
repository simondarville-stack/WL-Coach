/*
  # Create training_log_exercises table

  1. New Tables
    - `training_log_exercises`
      - `id` (uuid, primary key)
      - `session_id` (uuid, foreign key to training_log_sessions)
      - `exercise_id` (uuid, foreign key to exercises)
      - `planned_exercise_id` (uuid, foreign key to planned_exercises, optional)
      - `performed_raw` (text) - What athlete actually performed (shorthand notation)
      - `performed_notes` (text) - Optional notes about performance
      - `position` (integer) - Ordering within session
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `training_log_exercises` table
    - Allow authenticated users to read all log exercises
    - Allow authenticated users to insert log exercises
    - Allow authenticated users to update log exercises
    - Allow authenticated users to delete log exercises
  
  3. Notes
    - Each log exercise belongs to a session
    - Optional reference to planned_exercise for comparison
    - Uses same shorthand notation as planning (e.g., "300x3, 280x3x2")
*/

CREATE TABLE IF NOT EXISTS training_log_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES training_log_sessions(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  planned_exercise_id uuid REFERENCES planned_exercises(id) ON DELETE SET NULL,
  performed_raw text DEFAULT '',
  performed_notes text DEFAULT '',
  position integer DEFAULT 0 NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE training_log_exercises ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all log exercises
CREATE POLICY "Authenticated users can read all training log exercises"
  ON training_log_exercises
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert log exercises
CREATE POLICY "Authenticated users can insert training log exercises"
  ON training_log_exercises
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update log exercises
CREATE POLICY "Authenticated users can update training log exercises"
  ON training_log_exercises
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete log exercises
CREATE POLICY "Authenticated users can delete training log exercises"
  ON training_log_exercises
  FOR DELETE
  TO authenticated
  USING (true);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_training_log_exercises_session 
  ON training_log_exercises(session_id);
CREATE INDEX IF NOT EXISTS idx_training_log_exercises_planned 
  ON training_log_exercises(planned_exercise_id);
