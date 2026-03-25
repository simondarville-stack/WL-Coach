/*
  # Add exercise code and week-specific active days

  1. Changes to exercises table
    - Add exercise_code field (text, optional, unique) for quick search/reference
    - This allows users to assign short codes like "SN", "CJ", "BS" for faster lookup

  2. Changes to week_plans table
    - Add active_days field (integer array) to store which days are active for each week
    - Different weeks can have different training schedules (e.g., 3 days vs 4 days)
    - Defaults to [1,2,3,4,5] (Monday through Friday)

  3. Notes
    - exercise_code is optional but must be unique if provided
    - active_days stores day indices (1=Monday, 7=Sunday)
*/

-- Add exercise_code column to exercises table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'exercises' AND column_name = 'exercise_code'
  ) THEN
    ALTER TABLE exercises ADD COLUMN exercise_code text UNIQUE;
  END IF;
END $$;

-- Add index on exercise_code for faster lookups
CREATE INDEX IF NOT EXISTS idx_exercises_code ON exercises(exercise_code) WHERE exercise_code IS NOT NULL;

-- Add active_days column to week_plans table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'week_plans' AND column_name = 'active_days'
  ) THEN
    ALTER TABLE week_plans ADD COLUMN active_days integer[] DEFAULT ARRAY[1,2,3,4,5] NOT NULL;
  END IF;
END $$;

-- Set default active_days for existing week plans
UPDATE week_plans SET active_days = ARRAY[1,2,3,4,5] WHERE active_days IS NULL OR active_days = ARRAY[]::integer[];
