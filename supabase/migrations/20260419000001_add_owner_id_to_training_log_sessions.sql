-- Apply with: supabase db push (user must apply)
-- Adds owner_id to training_log_sessions for multi-coach data isolation.

ALTER TABLE training_log_sessions
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES coach_profiles(id) ON DELETE CASCADE;

-- Backfill owner_id from athletes.owner_id via athlete_id
UPDATE training_log_sessions tls
SET owner_id = a.owner_id
FROM athletes a
WHERE tls.athlete_id = a.id
  AND tls.owner_id IS NULL;

-- Make column NOT NULL after backfill
ALTER TABLE training_log_sessions
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_training_log_sessions_owner_id
  ON training_log_sessions(owner_id);
