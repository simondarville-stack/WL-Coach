-- Add combo support to planned_exercises
ALTER TABLE planned_exercises
  ADD COLUMN IF NOT EXISTS is_combo boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_notation text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS combo_color text DEFAULT NULL;

-- Add reps_text to set_lines for tuple storage ("2+1", "1+1+1")
ALTER TABLE planned_set_lines
  ADD COLUMN IF NOT EXISTS reps_text text DEFAULT NULL;

-- Lightweight join: which exercises make up this combo
CREATE TABLE IF NOT EXISTS planned_exercise_combo_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  planned_exercise_id uuid REFERENCES planned_exercises(id) ON DELETE CASCADE,
  exercise_id uuid REFERENCES exercises(id),
  position integer NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- RLS for combo members
ALTER TABLE planned_exercise_combo_members ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Allow anon access to planned_exercise_combo_members" ON planned_exercise_combo_members;
  CREATE POLICY "Allow anon access to planned_exercise_combo_members" ON planned_exercise_combo_members FOR ALL TO anon USING (true) WITH CHECK (true);
END $$;
