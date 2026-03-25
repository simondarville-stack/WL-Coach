/*
  # Add planned sets and metrics tracking

  1. Updates to planned_exercises table
    - Add `unit` (text) - The unit for this specific planned exercise (%, kg, or RPE)
    - Add `summary_total_sets` (integer) - Total number of sets across all set lines
    - Add `summary_total_reps` (integer) - Total reps (sum of sets * reps)
    - Add `summary_highest_load` (decimal) - Highest load value across all set lines
    - Add `summary_avg_load` (decimal) - Weighted average load by reps

  2. New Table: planned_set_lines
    - `id` (uuid, primary key)
    - `planned_exercise_id` (uuid, foreign key to planned_exercises)
    - `sets` (integer) - Number of sets (e.g., 5)
    - `reps` (integer) - Number of reps per set (e.g., 3)
    - `load_value` (decimal) - Load value (meaning depends on unit: 80 for 80%, 120 for 120kg, 8 for RPE 8)
    - `position` (integer) - Order within the planned exercise
    - `notes` (text, optional)
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  3. Security
    - Enable RLS on planned_set_lines
    - Allow public access (single-user workspace)

  4. Constraints
    - Unique constraint on (planned_exercise_id, position)
    - Check constraints for positive values
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_exercises' AND column_name = 'unit'
  ) THEN
    ALTER TABLE planned_exercises ADD COLUMN unit text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_exercises' AND column_name = 'summary_total_sets'
  ) THEN
    ALTER TABLE planned_exercises ADD COLUMN summary_total_sets integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_exercises' AND column_name = 'summary_total_reps'
  ) THEN
    ALTER TABLE planned_exercises ADD COLUMN summary_total_reps integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_exercises' AND column_name = 'summary_highest_load'
  ) THEN
    ALTER TABLE planned_exercises ADD COLUMN summary_highest_load decimal;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'planned_exercises' AND column_name = 'summary_avg_load'
  ) THEN
    ALTER TABLE planned_exercises ADD COLUMN summary_avg_load decimal;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS planned_set_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_exercise_id uuid NOT NULL REFERENCES planned_exercises(id) ON DELETE CASCADE,
  sets integer NOT NULL DEFAULT 3,
  reps integer NOT NULL DEFAULT 3,
  load_value decimal NOT NULL DEFAULT 0,
  position integer NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT positive_sets CHECK (sets > 0),
  CONSTRAINT positive_reps CHECK (reps > 0),
  CONSTRAINT non_negative_load CHECK (load_value >= 0),
  UNIQUE(planned_exercise_id, position)
);

ALTER TABLE planned_set_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view planned set lines"
  ON planned_set_lines
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert planned set lines"
  ON planned_set_lines
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update planned set lines"
  ON planned_set_lines
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete planned set lines"
  ON planned_set_lines
  FOR DELETE
  USING (true);

CREATE INDEX IF NOT EXISTS idx_planned_set_lines_exercise ON planned_set_lines(planned_exercise_id);
CREATE INDEX IF NOT EXISTS idx_planned_set_lines_position ON planned_set_lines(planned_exercise_id, position);
