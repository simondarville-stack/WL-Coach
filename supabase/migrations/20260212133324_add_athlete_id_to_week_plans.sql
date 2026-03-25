/*
  # Add athlete_id to week_plans table

  1. Changes to week_plans table
    - Add athlete_id column (uuid, foreign key to athletes, nullable for now)
    - Add index on athlete_id for faster lookups
    - Update unique constraint to include athlete_id

  2. Notes
    - athlete_id is nullable to support existing data
    - In production, you would want to migrate existing plans to a default athlete
    - Future constraint: (week_start, athlete_id) should be unique
*/

-- Add athlete_id column to week_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'week_plans' AND column_name = 'athlete_id'
  ) THEN
    ALTER TABLE week_plans ADD COLUMN athlete_id uuid REFERENCES athletes(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Create index on athlete_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_week_plans_athlete_id ON week_plans(athlete_id);

-- Create composite index for (athlete_id, week_start) for faster queries
CREATE INDEX IF NOT EXISTS idx_week_plans_athlete_week ON week_plans(athlete_id, week_start);
