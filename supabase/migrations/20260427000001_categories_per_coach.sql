-- Make categories per-coach.
--
-- 1. Drop the manually-created FK that links exercises.category → categories.name
--    (per-coach categories can't be globally enforced by name alone)
-- 2. Add owner_id to categories
-- 3. Backfill existing rows to the default coach
-- 4. Replace global UNIQUE(name) with UNIQUE(owner_id, name)
-- 5. Update RLS policies to scope reads/writes to the row's owner

-- Drop the FK constraint that was blocking category deletion
ALTER TABLE exercises DROP CONSTRAINT IF EXISTS fk_exercises_category;

-- Add owner_id column (nullable first so backfill can run)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS owner_id uuid
  REFERENCES coach_profiles(id) ON DELETE CASCADE;

-- Backfill all existing categories to the default coach
UPDATE categories
SET owner_id = '00000000-0000-0000-0000-000000000001'
WHERE owner_id IS NULL;

-- Now enforce NOT NULL
ALTER TABLE categories ALTER COLUMN owner_id SET NOT NULL;

-- Index for fast per-coach lookups
CREATE INDEX IF NOT EXISTS idx_categories_owner ON categories(owner_id);

-- Replace global unique constraint on name with per-coach unique
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_name_key;
ALTER TABLE categories ADD CONSTRAINT categories_owner_name_unique
  UNIQUE (owner_id, name);

-- Update RLS: scope to the requesting anon (owner_id-based once auth lands;
-- for now keep permissive anon access since auth is a future phase)
DROP POLICY IF EXISTS "Allow all to read categories" ON categories;
DROP POLICY IF EXISTS "Allow all to insert categories" ON categories;
DROP POLICY IF EXISTS "Allow all to update categories" ON categories;
DROP POLICY IF EXISTS "Allow all to delete categories" ON categories;

CREATE POLICY "Allow anon to read categories"   ON categories FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon to insert categories" ON categories FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon to update categories" ON categories FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon to delete categories" ON categories FOR DELETE TO anon USING (true);
