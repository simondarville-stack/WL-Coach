-- PROPOSED MIGRATION — REQUIRES MANUAL APPLICATION
-- Allow general athlete↔coach threads that are NOT tied to a specific
-- training session. We reuse training_log_messages so all the existing
-- read-tracking, owner_id isolation, sender_type, and RLS apply.
--
-- Schema change:
--   1. Add athlete_id (nullable) so general messages (no session) can
--      still be addressed to a specific athlete. Backfill from the
--      parent session for existing rows so the column is always
--      authoritative going forward.
--   2. Make session_id nullable so general messages can exist.
--   3. CHECK constraint guarantees every row points at SOMETHING
--      (either a session or an athlete) — no orphan rows allowed.
--   4. Index on (owner_id, athlete_id) accelerates the coach-inbox
--      general-thread lookup and the athlete-app general-thread fetch.
--
-- Rollback:
--   ALTER TABLE training_log_messages DROP CONSTRAINT IF EXISTS
--     training_log_messages_target_present;
--   ALTER TABLE training_log_messages ALTER COLUMN session_id SET NOT NULL;
--   DROP INDEX IF EXISTS idx_training_log_messages_owner_athlete;
--   ALTER TABLE training_log_messages DROP COLUMN IF EXISTS athlete_id;

-- Step 1: add athlete_id column
ALTER TABLE training_log_messages
  ADD COLUMN IF NOT EXISTS athlete_id uuid NULL
  REFERENCES athletes(id) ON DELETE CASCADE;

-- Step 2: backfill athlete_id from the session for existing rows
UPDATE training_log_messages tlm
SET athlete_id = tls.athlete_id
FROM training_log_sessions tls
WHERE tlm.session_id = tls.id
  AND tlm.athlete_id IS NULL;

-- Step 3: relax the session_id NOT NULL constraint
ALTER TABLE training_log_messages
  ALTER COLUMN session_id DROP NOT NULL;

-- Step 4: ensure every message has at least one target
ALTER TABLE training_log_messages
  DROP CONSTRAINT IF EXISTS training_log_messages_target_present;
ALTER TABLE training_log_messages
  ADD CONSTRAINT training_log_messages_target_present
  CHECK (session_id IS NOT NULL OR athlete_id IS NOT NULL);

-- Step 5: index for general-thread lookups
CREATE INDEX IF NOT EXISTS idx_training_log_messages_owner_athlete
  ON training_log_messages(owner_id, athlete_id)
  WHERE session_id IS NULL;

-- Step 6: trigger to auto-populate owner_id / athlete_id from session
-- when the inserter only sets session_id. Without this, existing
-- addComment callers (which don't pass owner_id) produce rows that
-- the coach inbox can't see, because the inbox filters by owner_id.
CREATE OR REPLACE FUNCTION training_log_messages_fill_from_session()
RETURNS trigger AS $$
BEGIN
  IF NEW.session_id IS NOT NULL THEN
    IF NEW.owner_id IS NULL OR NEW.athlete_id IS NULL THEN
      SELECT
        COALESCE(NEW.owner_id, tls.owner_id),
        COALESCE(NEW.athlete_id, tls.athlete_id)
      INTO NEW.owner_id, NEW.athlete_id
      FROM training_log_sessions tls
      WHERE tls.id = NEW.session_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_training_log_messages_fill_from_session
  ON training_log_messages;
CREATE TRIGGER trg_training_log_messages_fill_from_session
  BEFORE INSERT ON training_log_messages
  FOR EACH ROW
  EXECUTE FUNCTION training_log_messages_fill_from_session();
