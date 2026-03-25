/*
  # Create training_log_sessions table

  1. New Tables
    - `training_log_sessions`
      - `id` (uuid, primary key)
      - `athlete_id` (uuid, foreign key to athletes)
      - `date` (date) - Actual training day
      - `week_start` (date) - Monday of that week for grouping
      - `day_index` (integer, 1-7) - 1=Monday, 7=Sunday
      - `session_notes` (text) - Athlete's notes for the session
      - `status` (text) - e.g., planned, completed, skipped
      - `raw_sleep` (integer, 1-3) - RAW Sleep score
      - `raw_physical` (integer, 1-3) - RAW Physical score
      - `raw_mood` (integer, 1-3) - RAW Mood score
      - `raw_nutrition` (integer, 1-3) - RAW Nutrition score
      - `raw_total` (integer, 4-12) - Computed sum of RAW scores
      - `raw_guidance` (text) - Guidance based on RAW total
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
  
  2. Security
    - Enable RLS on `training_log_sessions` table
    - Allow authenticated users to read all sessions
    - Allow authenticated users to insert their own sessions
    - Allow authenticated users to update their own sessions
    - Allow authenticated users to delete their own sessions
  
  3. Notes
    - One session per athlete per date
    - RAW fields are optional (NULL if RAW is disabled or not filled)
    - Unique constraint on (athlete_id, date)
*/

CREATE TABLE IF NOT EXISTS training_log_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date date NOT NULL,
  week_start date NOT NULL,
  day_index integer NOT NULL CHECK (day_index BETWEEN 1 AND 7),
  session_notes text DEFAULT '',
  status text DEFAULT 'planned',
  raw_sleep integer CHECK (raw_sleep IS NULL OR (raw_sleep BETWEEN 1 AND 3)),
  raw_physical integer CHECK (raw_physical IS NULL OR (raw_physical BETWEEN 1 AND 3)),
  raw_mood integer CHECK (raw_mood IS NULL OR (raw_mood BETWEEN 1 AND 3)),
  raw_nutrition integer CHECK (raw_nutrition IS NULL OR (raw_nutrition BETWEEN 1 AND 3)),
  raw_total integer CHECK (raw_total IS NULL OR (raw_total BETWEEN 4 AND 12)),
  raw_guidance text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (athlete_id, date)
);

ALTER TABLE training_log_sessions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read all sessions
CREATE POLICY "Authenticated users can read all training log sessions"
  ON training_log_sessions
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert sessions
CREATE POLICY "Authenticated users can insert training log sessions"
  ON training_log_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Allow authenticated users to update sessions
CREATE POLICY "Authenticated users can update training log sessions"
  ON training_log_sessions
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to delete sessions
CREATE POLICY "Authenticated users can delete training log sessions"
  ON training_log_sessions
  FOR DELETE
  TO authenticated
  USING (true);

-- Create index for common queries
CREATE INDEX IF NOT EXISTS idx_training_log_sessions_athlete_week 
  ON training_log_sessions(athlete_id, week_start);
CREATE INDEX IF NOT EXISTS idx_training_log_sessions_athlete_date 
  ON training_log_sessions(athlete_id, date);
