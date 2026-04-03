-- Training log set-by-set tracking
CREATE TABLE IF NOT EXISTS training_log_sets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  log_exercise_id uuid NOT NULL REFERENCES training_log_exercises(id) ON DELETE CASCADE,
  set_number integer NOT NULL,
  planned_load numeric DEFAULT NULL,
  planned_reps integer DEFAULT NULL,
  performed_load numeric DEFAULT NULL,
  performed_reps integer DEFAULT NULL,
  rpe numeric DEFAULT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'skipped', 'failed')),
  notes text DEFAULT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Session timing
ALTER TABLE training_log_sessions
  ADD COLUMN IF NOT EXISTS started_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS duration_minutes integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS session_rpe numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS bodyweight_kg numeric DEFAULT NULL;

-- Exercise-level feedback
ALTER TABLE training_log_exercises
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  ADD COLUMN IF NOT EXISTS technique_rating integer DEFAULT NULL
    CHECK (technique_rating >= 1 AND technique_rating <= 5),
  ADD COLUMN IF NOT EXISTS started_at timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT NULL;

-- Coach notifications / messages
CREATE TABLE IF NOT EXISTS training_log_messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES training_log_sessions(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES training_log_exercises(id) ON DELETE CASCADE,
  sender_type text NOT NULL CHECK (sender_type IN ('athlete', 'coach')),
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);
