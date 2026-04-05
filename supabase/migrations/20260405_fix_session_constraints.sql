-- Fix training_log_sessions to use slot-based uniqueness instead of date-based
-- Run in Supabase SQL Editor

-- 1. Remove the day_index 1-7 constraint (slots can be 8, 9, etc.)
ALTER TABLE training_log_sessions
  DROP CONSTRAINT IF EXISTS training_log_sessions_day_index_check;
ALTER TABLE training_log_sessions
  ADD CONSTRAINT training_log_sessions_day_index_check CHECK (day_index >= 1);

-- 2. Change unique constraint from (athlete_id, date) to (athlete_id, week_start, day_index)
--    This allows:
--    - Multiple sessions on the same calendar date (different training slots)
--    - Only one session per training slot per week (logical uniqueness)
ALTER TABLE training_log_sessions
  DROP CONSTRAINT IF EXISTS training_log_sessions_athlete_id_date_key;
ALTER TABLE training_log_sessions
  ADD CONSTRAINT training_log_sessions_athlete_week_day_key
  UNIQUE (athlete_id, week_start, day_index);

-- 3. Add index for the new lookup pattern
CREATE INDEX IF NOT EXISTS idx_training_log_sessions_athlete_week_day
  ON training_log_sessions(athlete_id, week_start, day_index);
