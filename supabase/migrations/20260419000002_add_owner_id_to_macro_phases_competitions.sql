-- Apply with: supabase db push (user must apply)
-- Adds owner_id to macro_phases and macro_competitions for multi-coach data isolation.

-- macro_phases
ALTER TABLE macro_phases
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES coach_profiles(id) ON DELETE CASCADE;

UPDATE macro_phases mp
SET owner_id = mc.owner_id
FROM macrocycles mc
WHERE mp.macrocycle_id = mc.id
  AND mp.owner_id IS NULL;

ALTER TABLE macro_phases
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_macro_phases_owner_id
  ON macro_phases(owner_id);

-- macro_competitions
ALTER TABLE macro_competitions
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES coach_profiles(id) ON DELETE CASCADE;

UPDATE macro_competitions mcomp
SET owner_id = mc.owner_id
FROM macrocycles mc
WHERE mcomp.macrocycle_id = mc.id
  AND mcomp.owner_id IS NULL;

ALTER TABLE macro_competitions
  ALTER COLUMN owner_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_macro_competitions_owner_id
  ON macro_competitions(owner_id);
