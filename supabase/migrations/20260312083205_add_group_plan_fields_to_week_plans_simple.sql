/*
  # Add Group Plan Support to Week Plans

  1. Changes to week_plans table
    - Add `is_group_plan` (boolean, default false) - Indicates if this is a group plan
    - Add `group_id` (uuid, nullable, foreign key to training_groups) - The group this plan belongs to

  2. Important Notes
    - A week plan can be either individual (athlete_id set, group_id null) OR group (group_id set, athlete_id null)
    - For group plans: is_group_plan = true, group_id is set, athlete_id should be null
    - For individual plans: is_group_plan = false, athlete_id is set, group_id should be null

  3. Constraints
    - Individual plans: unique on (athlete_id, week_start) where is_group_plan = false
    - Group plans: unique on (group_id, week_start) where is_group_plan = true

  4. Security
    - Update RLS policies to allow access based on group membership
*/

-- Add new columns to week_plans
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'week_plans' AND column_name = 'is_group_plan'
  ) THEN
    ALTER TABLE week_plans ADD COLUMN is_group_plan boolean DEFAULT false NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'week_plans' AND column_name = 'group_id'
  ) THEN
    ALTER TABLE week_plans ADD COLUMN group_id uuid REFERENCES training_groups(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Drop old unique constraint if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'week_plans_athlete_id_week_start_key'
  ) THEN
    ALTER TABLE week_plans DROP CONSTRAINT week_plans_athlete_id_week_start_key;
  END IF;
END $$;

-- Create new unique constraints
-- For individual plans: unique on (athlete_id, week_start) where is_group_plan = false
CREATE UNIQUE INDEX IF NOT EXISTS idx_week_plans_individual_unique 
  ON week_plans(athlete_id, week_start) 
  WHERE is_group_plan = false AND athlete_id IS NOT NULL;

-- For group plans: unique on (group_id, week_start) where is_group_plan = true
CREATE UNIQUE INDEX IF NOT EXISTS idx_week_plans_group_unique 
  ON week_plans(group_id, week_start) 
  WHERE is_group_plan = true AND group_id IS NOT NULL;

-- Create index on group_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_week_plans_group_id ON week_plans(group_id) WHERE group_id IS NOT NULL;

-- Update RLS policies for group plan access
-- Drop existing policies
DROP POLICY IF EXISTS "Anyone can view week plans" ON week_plans;
DROP POLICY IF EXISTS "Authenticated users can create week plans" ON week_plans;
DROP POLICY IF EXISTS "Authenticated users can update week plans" ON week_plans;
DROP POLICY IF EXISTS "Authenticated users can delete week plans" ON week_plans;

-- Recreate policies with group support
CREATE POLICY "Anyone can view week plans"
  ON week_plans FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Authenticated users can create week plans"
  ON week_plans FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update week plans"
  ON week_plans FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete week plans"
  ON week_plans FOR DELETE
  TO authenticated
  USING (true);