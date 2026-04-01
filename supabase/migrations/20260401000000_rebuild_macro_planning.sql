-- Rebuild macro planning: new tables, altered columns, expanded week_type constraint

-- 1. Create macro_phases table
CREATE TABLE IF NOT EXISTS macro_phases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  macrocycle_id uuid REFERENCES macrocycles(id) ON DELETE CASCADE,
  name text NOT NULL,
  phase_type text NOT NULL DEFAULT 'custom',
  start_week_number int NOT NULL,
  end_week_number int NOT NULL,
  color text DEFAULT '#E5E7EB',
  notes text DEFAULT '',
  position int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE macro_phases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can view macro_phases" ON macro_phases;
  CREATE POLICY "Anyone can view macro_phases"
    ON macro_phases FOR SELECT TO anon, authenticated USING (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can insert macro_phases" ON macro_phases;
  CREATE POLICY "Anyone can insert macro_phases"
    ON macro_phases FOR INSERT TO anon, authenticated WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can update macro_phases" ON macro_phases;
  CREATE POLICY "Anyone can update macro_phases"
    ON macro_phases FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can delete macro_phases" ON macro_phases;
  CREATE POLICY "Anyone can delete macro_phases"
    ON macro_phases FOR DELETE TO anon, authenticated USING (true);
END $$;

-- 2. Create macro_competitions table
CREATE TABLE IF NOT EXISTS macro_competitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  macrocycle_id uuid REFERENCES macrocycles(id) ON DELETE CASCADE,
  competition_name text NOT NULL,
  competition_date date NOT NULL,
  is_primary boolean DEFAULT false,
  event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE macro_competitions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can view macro_competitions" ON macro_competitions;
  CREATE POLICY "Anyone can view macro_competitions"
    ON macro_competitions FOR SELECT TO anon, authenticated USING (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can insert macro_competitions" ON macro_competitions;
  CREATE POLICY "Anyone can insert macro_competitions"
    ON macro_competitions FOR INSERT TO anon, authenticated WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can update macro_competitions" ON macro_competitions;
  CREATE POLICY "Anyone can update macro_competitions"
    ON macro_competitions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
END $$;

DO $$ BEGIN
  DROP POLICY IF EXISTS "Anyone can delete macro_competitions" ON macro_competitions;
  CREATE POLICY "Anyone can delete macro_competitions"
    ON macro_competitions FOR DELETE TO anon, authenticated USING (true);
END $$;

-- 3. Alter macro_weeks: add phase_id and volume_multiplier
ALTER TABLE macro_weeks
  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES macro_phases(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS volume_multiplier numeric DEFAULT 1.0;

-- 4. Expand week_type constraint to include Transition and Testing
-- Drop the old constraint (name may vary — use DO block to avoid error if not found)
DO $$ BEGIN
  ALTER TABLE macro_weeks DROP CONSTRAINT IF EXISTS macro_weeks_week_type_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE macro_weeks
  ADD CONSTRAINT macro_weeks_week_type_check
  CHECK (week_type IN ('High', 'Medium', 'Low', 'Vacation', 'Deload', 'Taper', 'Competition', 'Transition', 'Testing'));

-- 5. Alter general_settings: add default_tracked_exercise_ids
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS default_tracked_exercise_ids text[] DEFAULT '{}';
