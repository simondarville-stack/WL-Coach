-- ══════════════════════════════════════════════════════════════
-- PHASE 1: Coach profiles + owner_id on root tables
-- No auth integration — just data isolation by owner_id
-- ══════════════════════════════════════════════════════════════

-- 1. Coach profiles table
CREATE TABLE IF NOT EXISTS coach_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text DEFAULT NULL,
  photo_url text DEFAULT NULL,
  club_name text DEFAULT NULL,
  locale text DEFAULT 'en',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE coach_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON coach_profiles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. Seed a default coach (all existing data will belong to this coach)
INSERT INTO coach_profiles (id, name, club_name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Coach', 'My Club')
ON CONFLICT (id) DO NOTHING;

-- 3. Add owner_id to root tables
-- Each gets: column + default + FK + index + backfill

-- athletes
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE athletes SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE athletes ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_athletes_owner ON athletes(owner_id);

-- exercises
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE exercises SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE exercises ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exercises_owner ON exercises(owner_id);

-- Fix exercise_code uniqueness: per-coach, not global
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS exercises_exercise_code_key;
ALTER TABLE exercises ADD CONSTRAINT exercises_owner_code_unique
  UNIQUE (owner_id, exercise_code);

-- Fix exercise deletion: prevent CASCADE data loss
-- planned_exercises: block deletion if exercise is in any plan
ALTER TABLE planned_exercises DROP CONSTRAINT IF EXISTS planned_exercises_exercise_id_fkey;
ALTER TABLE planned_exercises ADD CONSTRAINT planned_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

-- training_log_exercises: keep history, null out the reference
ALTER TABLE training_log_exercises DROP CONSTRAINT IF EXISTS training_log_exercises_exercise_id_fkey;
ALTER TABLE training_log_exercises ADD CONSTRAINT training_log_exercises_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE SET NULL;
-- exercise_id must become nullable for SET NULL to work
ALTER TABLE training_log_exercises ALTER COLUMN exercise_id DROP NOT NULL;

-- athlete_prs: block deletion if PRs exist
ALTER TABLE athlete_prs DROP CONSTRAINT IF EXISTS athlete_prs_exercise_id_fkey;
ALTER TABLE athlete_prs ADD CONSTRAINT athlete_prs_exercise_id_fkey
  FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE RESTRICT;

-- Add soft-delete to exercises (archive instead of delete)
ALTER TABLE exercises ADD COLUMN IF NOT EXISTS is_archived boolean DEFAULT false;

-- week_plans
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE week_plans SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE week_plans ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_week_plans_owner ON week_plans(owner_id);

-- macrocycles
ALTER TABLE macrocycles
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE macrocycles SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE macrocycles ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_macrocycles_owner ON macrocycles(owner_id);

-- events
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE events SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE events ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_owner ON events(owner_id);

-- training_groups
ALTER TABLE training_groups
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE training_groups SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE training_groups ALTER COLUMN owner_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_training_groups_owner ON training_groups(owner_id);

-- general_settings
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE
  DEFAULT '00000000-0000-0000-0000-000000000001';
UPDATE general_settings SET owner_id = '00000000-0000-0000-0000-000000000001' WHERE owner_id IS NULL;
ALTER TABLE general_settings ALTER COLUMN owner_id SET NOT NULL;
-- Make settings unique per coach
ALTER TABLE general_settings
  DROP CONSTRAINT IF EXISTS general_settings_owner_unique;
ALTER TABLE general_settings
  ADD CONSTRAINT general_settings_owner_unique UNIQUE (owner_id);
CREATE INDEX IF NOT EXISTS idx_general_settings_owner ON general_settings(owner_id);
