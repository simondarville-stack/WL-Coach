/*
  # Create weekly planning tables

  1. New Tables
    - `week_plans`
      - `id` (uuid, primary key)
      - `week_start` (date, required) - The Monday of the week
      - `name` (text, optional) - e.g. "Week 7"
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      
    - `planned_exercises`
      - `id` (uuid, primary key)
      - `weekplan_id` (uuid, foreign key to week_plans)
      - `day_index` (integer, 1-7 where 1=Mon, 7=Sun)
      - `exercise_id` (uuid, foreign key to exercises)
      - `position` (integer) - Order within the day (1, 2, 3...)
      - `notes` (text, optional)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on both tables
    - Allow public access for now (single-user shared workspace)

  3. Constraints
    - day_index must be between 1 and 7
    - Unique constraint on (weekplan_id, day_index, position)
*/

CREATE TABLE IF NOT EXISTS week_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start date NOT NULL,
  name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(week_start)
);

CREATE TABLE IF NOT EXISTS planned_exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekplan_id uuid NOT NULL REFERENCES week_plans(id) ON DELETE CASCADE,
  day_index integer NOT NULL,
  exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
  position integer NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT valid_day_index CHECK (day_index >= 1 AND day_index <= 7),
  UNIQUE(weekplan_id, day_index, position)
);

ALTER TABLE week_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE planned_exercises ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view week plans"
  ON week_plans
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert week plans"
  ON week_plans
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update week plans"
  ON week_plans
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete week plans"
  ON week_plans
  FOR DELETE
  USING (true);

CREATE POLICY "Anyone can view planned exercises"
  ON planned_exercises
  FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert planned exercises"
  ON planned_exercises
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update planned exercises"
  ON planned_exercises
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete planned exercises"
  ON planned_exercises
  FOR DELETE
  USING (true);

CREATE INDEX IF NOT EXISTS idx_week_plans_week_start ON week_plans(week_start);
CREATE INDEX IF NOT EXISTS idx_planned_exercises_weekplan ON planned_exercises(weekplan_id);
CREATE INDEX IF NOT EXISTS idx_planned_exercises_day ON planned_exercises(weekplan_id, day_index);
CREATE INDEX IF NOT EXISTS idx_planned_exercises_position ON planned_exercises(weekplan_id, day_index, position);
