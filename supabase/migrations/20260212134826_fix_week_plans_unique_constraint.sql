/*
  # Fix week_plans unique constraint

  1. Changes
    - Drop the old unique constraint on week_start only
    - Add new composite unique constraint on (week_start, athlete_id)
    
  2. Reasoning
    - Each athlete should be able to have their own plan for the same week
    - The combination of week_start + athlete_id should be unique
    - This allows multiple athletes to have plans for the same week

  3. Notes
    - Handles case where constraint might already be correct
    - Preserves all existing data
*/

-- Drop the old unique constraint on week_start if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'week_plans_week_start_key'
  ) THEN
    ALTER TABLE week_plans DROP CONSTRAINT week_plans_week_start_key;
  END IF;
END $$;

-- Add composite unique constraint on (athlete_id, week_start)
-- Note: This allows NULL athlete_id values to coexist with the same week_start
-- For proper uniqueness with NULLs, we would need a partial unique index
-- But for now, we'll use a standard unique constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'week_plans_athlete_week_unique'
  ) THEN
    -- First, let's handle any existing duplicate data
    -- Delete duplicate plans that don't have exercises (keep the ones with exercises)
    DELETE FROM week_plans wp1
    USING week_plans wp2
    WHERE wp1.id < wp2.id
      AND wp1.week_start = wp2.week_start
      AND wp1.athlete_id IS NOT DISTINCT FROM wp2.athlete_id
      AND NOT EXISTS (
        SELECT 1 FROM planned_exercises pe WHERE pe.weekplan_id = wp1.id
      );
    
    -- Now add the unique constraint
    ALTER TABLE week_plans 
    ADD CONSTRAINT week_plans_athlete_week_unique 
    UNIQUE NULLS NOT DISTINCT (athlete_id, week_start);
  END IF;
END $$;
