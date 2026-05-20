-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A7: UF-41 (DA-01, DA-02, DA-03, DB-02)
-- Add owner_id to training_log_exercises, training_log_sets, and
-- training_log_messages. Backfill from parent chain. Enable RLS on the two
-- tables that currently have it disabled (training_log_sets,
-- training_log_messages). Add permissive anon transitional policies so the
-- current anonymous-access model continues to work until Auth cutover.

-- Rollback:
--   ALTER TABLE training_log_exercises DROP COLUMN IF EXISTS owner_id;
--   ALTER TABLE training_log_sets       DROP COLUMN IF EXISTS owner_id;
--   ALTER TABLE training_log_messages   DROP COLUMN IF EXISTS owner_id;
--   DROP POLICY IF EXISTS anon_all ON training_log_sets;
--   DROP POLICY IF EXISTS anon_all ON training_log_messages;
--   ALTER TABLE training_log_sets     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE training_log_messages DISABLE ROW LEVEL SECURITY;

-- Step 1: Add nullable owner_id columns
ALTER TABLE training_log_exercises
  ADD COLUMN IF NOT EXISTS owner_id uuid null;

ALTER TABLE training_log_sets
  ADD COLUMN IF NOT EXISTS owner_id uuid null;

ALTER TABLE training_log_messages
  ADD COLUMN IF NOT EXISTS owner_id uuid null;

-- Step 2: Backfill from parent chain
-- training_log_exercises: derive from training_log_sessions.owner_id
UPDATE training_log_exercises tle
SET owner_id = tls.owner_id
FROM training_log_sessions tls
WHERE tle.session_id = tls.id
  AND tle.owner_id IS NULL;

-- training_log_sets: derive via training_log_exercises → training_log_sessions
UPDATE training_log_sets tset
SET owner_id = tle.owner_id
FROM training_log_exercises tle
WHERE tset.log_exercise_id = tle.id
  AND tset.owner_id IS NULL;

-- training_log_messages: derive from training_log_sessions.owner_id
UPDATE training_log_messages tlm
SET owner_id = tls.owner_id
FROM training_log_sessions tls
WHERE tlm.session_id = tls.id
  AND tlm.owner_id IS NULL;

-- Step 3: Enable RLS on the two tables that currently have it disabled
ALTER TABLE training_log_sets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_log_messages ENABLE ROW LEVEL SECURITY;

-- Step 4: Permissive anon transitional policies
-- These replicate the "anon can do everything" pattern already used on
-- training_log_sessions and training_log_exercises. They will be replaced
-- with authenticated role policies when Auth cutover lands.
CREATE POLICY anon_all ON training_log_sets
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY anon_all ON training_log_messages
  FOR ALL TO anon USING (true) WITH CHECK (true);
