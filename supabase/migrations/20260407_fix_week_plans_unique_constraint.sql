-- Fix week_plans unique constraint: the old NULLS NOT DISTINCT constraint
-- blocks creating multiple group plans (all have athlete_id=NULL) for the same week.
-- Replace with two proper partial unique indexes.

-- 1. Drop the broken constraint
ALTER TABLE week_plans DROP CONSTRAINT IF EXISTS week_plans_athlete_week_unique;

-- 2. Individual plans: one plan per owner per athlete per week
CREATE UNIQUE INDEX IF NOT EXISTS week_plans_individual_unique
  ON week_plans (owner_id, athlete_id, week_start)
  WHERE athlete_id IS NOT NULL;

-- 3. Group plans: one plan per owner per group per week
CREATE UNIQUE INDEX IF NOT EXISTS week_plans_group_unique
  ON week_plans (owner_id, group_id, week_start)
  WHERE group_id IS NOT NULL;
