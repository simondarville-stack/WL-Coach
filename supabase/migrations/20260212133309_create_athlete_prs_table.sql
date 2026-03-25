/*
  # Create athlete PRs table

  1. New Tables
    - `athlete_prs`
      - `id` (uuid, primary key)
      - `athlete_id` (uuid, foreign key to athletes)
      - `exercise_id` (uuid, foreign key to exercises)
      - `pr_value_kg` (numeric, optional) - Personal record value in kg
      - `pr_date` (date, optional) - Date the PR was achieved
      - `notes` (text, optional) - Additional notes about the PR
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Constraints
    - Unique constraint on (athlete_id, exercise_id) - one PR per athlete per exercise

  3. Security
    - Enable RLS on `athlete_prs` table
    - Add policy for public access (temporary)

  4. Indexes
    - Index on athlete_id for faster lookups
    - Index on exercise_id for faster lookups
*/

CREATE TABLE IF NOT EXISTS athlete_prs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  pr_value_kg numeric(6,2),
  pr_date date,
  notes text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(athlete_id, exercise_id)
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_athlete_prs_athlete_id ON athlete_prs(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athlete_prs_exercise_id ON athlete_prs(exercise_id);

-- Enable RLS
ALTER TABLE athlete_prs ENABLE ROW LEVEL SECURITY;

-- Allow all operations for now
CREATE POLICY "Allow all access to athlete_prs"
  ON athlete_prs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create updated_at trigger
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_athlete_prs_updated_at'
  ) THEN
    CREATE TRIGGER update_athlete_prs_updated_at
      BEFORE UPDATE ON athlete_prs
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
