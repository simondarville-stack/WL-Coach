-- Shared exercise catalogues (docs/SHARED_EXERCISE_CATALOGUE_PLAN.md, Phase 1+2 schema).
--
-- Every catalogue is an exercise_libraries row — including each coach's
-- personal one. A club library is the club-level object other coaches lock
-- onto: members with role 'editor' shape the tree, members with role
-- 'viewer' get a read-only view of it (plus their own personal library).
-- Moving an exercise between libraries is a library_id update and the row
-- KEEPS ITS ID — planned exercises, logs, PRs and macro targets never need
-- rewriting when a catalogue is seeded from an existing library.
--
-- owner_id stays on exercises/categories (rollback path + the owner_id
-- pattern the future auth/RLS phase expects). It stops being the read key:
-- catalogue reads become "library_id IN (my visible libraries)".
--
-- Rollback:
--   DROP TRIGGER IF EXISTS exercises_default_library ON exercises;
--   DROP TRIGGER IF EXISTS categories_default_library ON categories;
--   DROP FUNCTION IF EXISTS set_default_library_id();
--   ALTER TABLE exercises  DROP COLUMN IF EXISTS library_id;
--   ALTER TABLE categories DROP COLUMN IF EXISTS library_id;
--   DROP TABLE IF EXISTS exercise_library_members;
--   DROP TABLE IF EXISTS exercise_libraries;

-- ─── exercise_libraries ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exercise_libraries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,                        -- "BVK", "Simon"
  kind            text NOT NULL CHECK (kind IN ('club', 'personal')),
  -- personal libraries belong to exactly one coach; club libraries to none.
  owner_coach_id  uuid REFERENCES coach_profiles(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'personal') = (owner_coach_id IS NOT NULL))
);

-- Exactly one personal library per coach.
CREATE UNIQUE INDEX IF NOT EXISTS exercise_libraries_personal_per_coach
  ON exercise_libraries (owner_coach_id)
  WHERE kind = 'personal';

ALTER TABLE exercise_libraries ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all ON exercise_libraries
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ─── exercise_library_members ───────────────────────────────────────────────
-- Mirrors athlete_collaborators (invite / accept / revoke) so there is one
-- sharing idiom in the product. Personal libraries have no member rows —
-- ownership is owner_coach_id.

CREATE TABLE IF NOT EXISTS exercise_library_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_id   uuid NOT NULL REFERENCES exercise_libraries(id) ON DELETE CASCADE,
  coach_id     uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,

  -- editor shapes the shared tree; viewer locks on read-only.
  role         text NOT NULL CHECK (role IN ('editor', 'viewer')),

  invited_by   uuid NOT NULL REFERENCES coach_profiles(id),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  -- null while the invite is pending; set when the invitee accepts.
  accepted_at  timestamptz,
  -- set when access is revoked (by an editor) or the member leaves/declines.
  revoked_at   timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- One row per (library, coach); re-invites mutate the existing row.
  UNIQUE (library_id, coach_id)
);

-- "Which catalogues can this coach see right now?" — the visibility predicate.
CREATE INDEX IF NOT EXISTS exercise_library_members_active_for_coach_idx
  ON exercise_library_members (coach_id, library_id)
  WHERE accepted_at IS NOT NULL AND revoked_at IS NULL;

-- "Who is in this catalogue?" — the members-management UI.
CREATE INDEX IF NOT EXISTS exercise_library_members_library_idx
  ON exercise_library_members (library_id);

ALTER TABLE exercise_library_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all ON exercise_library_members
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ─── library_id on the catalogue tables ─────────────────────────────────────

ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS library_id uuid REFERENCES exercise_libraries(id);
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS library_id uuid REFERENCES exercise_libraries(id);

CREATE INDEX IF NOT EXISTS exercises_library_idx  ON exercises (library_id);
CREATE INDEX IF NOT EXISTS categories_library_idx ON categories (library_id);

-- ─── Backfill: one personal library per coach, rows follow their owner ──────

INSERT INTO exercise_libraries (name, kind, owner_coach_id)
SELECT coalesce(nullif(trim(cp.name), ''), 'Personal'), 'personal', cp.id
FROM coach_profiles cp
WHERE NOT EXISTS (
  SELECT 1 FROM exercise_libraries l
  WHERE l.kind = 'personal' AND l.owner_coach_id = cp.id
);

UPDATE exercises e
SET library_id = l.id
FROM exercise_libraries l
WHERE l.kind = 'personal' AND l.owner_coach_id = e.owner_id
  AND e.library_id IS NULL;

UPDATE categories c
SET library_id = l.id
FROM exercise_libraries l
WHERE l.kind = 'personal' AND l.owner_coach_id = c.owner_id
  AND c.library_id IS NULL;

-- ─── Default trigger: inserts without an explicit library land personal ─────
-- Protects every existing insert path (sentinel creation, bulk import, the
-- athlete app) without touching it: library_id defaults to the owner's
-- personal library, created lazily for coaches added after this migration.

CREATE OR REPLACE FUNCTION set_default_library_id() RETURNS trigger AS $$
DECLARE lib uuid;
BEGIN
  IF NEW.library_id IS NULL THEN
    SELECT id INTO lib FROM exercise_libraries
    WHERE kind = 'personal' AND owner_coach_id = NEW.owner_id;
    IF lib IS NULL THEN
      INSERT INTO exercise_libraries (name, kind, owner_coach_id)
      VALUES (
        coalesce((SELECT nullif(trim(name), '') FROM coach_profiles WHERE id = NEW.owner_id), 'Personal'),
        'personal',
        NEW.owner_id
      )
      RETURNING id INTO lib;
    END IF;
    NEW.library_id := lib;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS exercises_default_library ON exercises;
CREATE TRIGGER exercises_default_library
  BEFORE INSERT ON exercises
  FOR EACH ROW EXECUTE FUNCTION set_default_library_id();

DROP TRIGGER IF EXISTS categories_default_library ON categories;
CREATE TRIGGER categories_default_library
  BEFORE INSERT ON categories
  FOR EACH ROW EXECUTE FUNCTION set_default_library_id();

-- ─── Uniqueness within a library ────────────────────────────────────────────
-- Codes are the shared-id guarantee's human face: one code, one exercise,
-- per catalogue. Existing UNIQUE (owner_id, exercise_code) stays (backfill is
-- 1:1 owner→personal, so no conflicts exist at migration time).

CREATE UNIQUE INDEX IF NOT EXISTS exercises_library_code_unique
  ON exercises (library_id, exercise_code)
  WHERE exercise_code IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_library_name_unique
  ON categories (library_id, name);
