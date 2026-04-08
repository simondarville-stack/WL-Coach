-- Allow macrocycles to belong to a group instead of an individual athlete
-- Exactly one of athlete_id or group_id must be set (not both, not neither)
ALTER TABLE macrocycles
  ADD COLUMN IF NOT EXISTS group_id uuid DEFAULT NULL
  REFERENCES training_groups(id) ON DELETE CASCADE;

-- Remove NOT NULL from athlete_id (it can now be null for group macros)
ALTER TABLE macrocycles ALTER COLUMN athlete_id DROP NOT NULL;

-- Ensure exactly one owner type
ALTER TABLE macrocycles
  ADD CONSTRAINT macrocycles_owner_check
  CHECK (
    (athlete_id IS NOT NULL AND group_id IS NULL)
    OR (athlete_id IS NULL AND group_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_macrocycles_group ON macrocycles(group_id);
