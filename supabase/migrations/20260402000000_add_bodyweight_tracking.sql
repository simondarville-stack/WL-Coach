-- Create bodyweight_entries table
CREATE TABLE IF NOT EXISTS bodyweight_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  date date NOT NULL,
  weight_kg numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(athlete_id, date)
);

-- Add track_bodyweight to athletes
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS track_bodyweight boolean DEFAULT true;

-- Add bodyweight_ma_days to general_settings
ALTER TABLE general_settings ADD COLUMN IF NOT EXISTS bodyweight_ma_days int DEFAULT 7;

-- RLS
ALTER TABLE bodyweight_entries ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  DROP POLICY IF EXISTS "anon_select_bodyweight_entries" ON bodyweight_entries;
  CREATE POLICY "anon_select_bodyweight_entries" ON bodyweight_entries FOR SELECT TO anon USING (true);
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "anon_insert_bodyweight_entries" ON bodyweight_entries;
  CREATE POLICY "anon_insert_bodyweight_entries" ON bodyweight_entries FOR INSERT TO anon WITH CHECK (true);
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "anon_update_bodyweight_entries" ON bodyweight_entries;
  CREATE POLICY "anon_update_bodyweight_entries" ON bodyweight_entries FOR UPDATE TO anon USING (true);
END $$;
DO $$ BEGIN
  DROP POLICY IF EXISTS "anon_delete_bodyweight_entries" ON bodyweight_entries;
  CREATE POLICY "anon_delete_bodyweight_entries" ON bodyweight_entries FOR DELETE TO anon USING (true);
END $$;

-- Seed from existing athletes.bodyweight
INSERT INTO bodyweight_entries (athlete_id, date, weight_kg)
SELECT id, CURRENT_DATE, bodyweight
FROM athletes
WHERE bodyweight IS NOT NULL
ON CONFLICT (athlete_id, date) DO NOTHING;
