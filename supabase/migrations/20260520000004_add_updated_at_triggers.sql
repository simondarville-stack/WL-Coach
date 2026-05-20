-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Group A4: UF-42 (DF-01, DF-02, DF-03)
-- Add moddatetime triggers to training_log_sets, training_log_exercises,
-- and training_log_sessions so updated_at is maintained correctly on every
-- UPDATE. Without these, updated_at always equals created_at after the
-- first insert, making last-write-wins logic (CLAUDE.md principle 4) wrong.

-- Rollback:
--   DROP TRIGGER IF EXISTS set_updated_at ON training_log_sets;
--   DROP TRIGGER IF EXISTS set_updated_at ON training_log_exercises;
--   DROP TRIGGER IF EXISTS set_updated_at ON training_log_sessions;
--   (The trigger function itself is shared — do not drop it if used elsewhere.)

-- Ensure the moddatetime extension is available (ships with Supabase by default).
CREATE EXTENSION IF NOT EXISTS moddatetime;

-- training_log_sets
CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON training_log_sets
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- training_log_exercises
CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON training_log_exercises
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- training_log_sessions
CREATE OR REPLACE TRIGGER set_updated_at
  BEFORE UPDATE ON training_log_sessions
  FOR EACH ROW
  EXECUTE FUNCTION extensions.moddatetime(updated_at);
