-- Add programme templates for the Weekly Designer Dock.
--
-- A template is a coach-authored bundle of one or more "template days",
-- each holding its own exercises with prescriptions. Templates are
-- per-coach (owner_id) and live alongside, not inside, week_plans.
-- The "apply to plan" path mirrors planned_exercises shape so copying
-- a template into a real day requires no field translation.
--
-- Tables:
--   program_templates              — header (name, description, tags)
--   program_template_days          — 1..N days inside a template
--   program_template_exercises     — exercises inside a template day
--                                    (mirrors planned_exercises columns)
--   program_template_combo_members — combo composition
--                                    (mirrors planned_exercise_combo_members)
--
-- RLS is enabled with permissive anon policies, matching the rest of
-- the schema until auth lands as a future phase.
--
-- This migration is NOT applied automatically. The user applies it.

CREATE TABLE IF NOT EXISTS program_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text,
  tags         text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS program_template_days (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id  uuid NOT NULL REFERENCES program_templates(id) ON DELETE CASCADE,
  day_index    integer NOT NULL,
  label        text NOT NULL DEFAULT 'Day',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_template_day_index CHECK (day_index >= 1),
  UNIQUE (template_id, day_index)
);

CREATE TABLE IF NOT EXISTS program_template_exercises (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_day_id  uuid NOT NULL REFERENCES program_template_days(id) ON DELETE CASCADE,
  exercise_id      uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position         integer NOT NULL,
  unit             text,
  prescription_raw text,
  notes            text,
  variation_note   text,
  is_combo         boolean NOT NULL DEFAULT false,
  combo_notation   text,
  combo_color      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS program_template_combo_members (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_exercise_id uuid NOT NULL REFERENCES program_template_exercises(id) ON DELETE CASCADE,
  exercise_id          uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position             integer NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_program_templates_owner
  ON program_templates(owner_id);

CREATE INDEX IF NOT EXISTS idx_program_template_days_template
  ON program_template_days(template_id);

CREATE INDEX IF NOT EXISTS idx_program_template_exercises_day
  ON program_template_exercises(template_day_id);

CREATE INDEX IF NOT EXISTS idx_program_template_exercises_position
  ON program_template_exercises(template_day_id, position);

CREATE INDEX IF NOT EXISTS idx_program_template_combo_members_exercise
  ON program_template_combo_members(template_exercise_id);

ALTER TABLE program_templates              ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_template_days          ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_template_exercises     ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_template_combo_members ENABLE ROW LEVEL SECURITY;

-- DROP IF EXISTS before each CREATE so re-running the migration after a
-- partial failure is safe. Postgres does not support CREATE POLICY ... IF
-- NOT EXISTS yet (as of pg 16).

DROP POLICY IF EXISTS "Allow anon to read program_templates"   ON program_templates;
DROP POLICY IF EXISTS "Allow anon to insert program_templates" ON program_templates;
DROP POLICY IF EXISTS "Allow anon to update program_templates" ON program_templates;
DROP POLICY IF EXISTS "Allow anon to delete program_templates" ON program_templates;

CREATE POLICY "Allow anon to read program_templates"
  ON program_templates FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert program_templates"
  ON program_templates FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update program_templates"
  ON program_templates FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete program_templates"
  ON program_templates FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon to read program_template_days"   ON program_template_days;
DROP POLICY IF EXISTS "Allow anon to insert program_template_days" ON program_template_days;
DROP POLICY IF EXISTS "Allow anon to update program_template_days" ON program_template_days;
DROP POLICY IF EXISTS "Allow anon to delete program_template_days" ON program_template_days;

CREATE POLICY "Allow anon to read program_template_days"
  ON program_template_days FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert program_template_days"
  ON program_template_days FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update program_template_days"
  ON program_template_days FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete program_template_days"
  ON program_template_days FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon to read program_template_exercises"   ON program_template_exercises;
DROP POLICY IF EXISTS "Allow anon to insert program_template_exercises" ON program_template_exercises;
DROP POLICY IF EXISTS "Allow anon to update program_template_exercises" ON program_template_exercises;
DROP POLICY IF EXISTS "Allow anon to delete program_template_exercises" ON program_template_exercises;

CREATE POLICY "Allow anon to read program_template_exercises"
  ON program_template_exercises FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert program_template_exercises"
  ON program_template_exercises FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update program_template_exercises"
  ON program_template_exercises FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete program_template_exercises"
  ON program_template_exercises FOR DELETE TO anon USING (true);

DROP POLICY IF EXISTS "Allow anon to read program_template_combo_members"   ON program_template_combo_members;
DROP POLICY IF EXISTS "Allow anon to insert program_template_combo_members" ON program_template_combo_members;
DROP POLICY IF EXISTS "Allow anon to update program_template_combo_members" ON program_template_combo_members;
DROP POLICY IF EXISTS "Allow anon to delete program_template_combo_members" ON program_template_combo_members;

CREATE POLICY "Allow anon to read program_template_combo_members"
  ON program_template_combo_members FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert program_template_combo_members"
  ON program_template_combo_members FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update program_template_combo_members"
  ON program_template_combo_members FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete program_template_combo_members"
  ON program_template_combo_members FOR DELETE TO anon USING (true);
