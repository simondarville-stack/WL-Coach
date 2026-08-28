-- Drop the legacy per-owner category uniqueness.
--
-- SHARED_EXERCISE_CATALOGUE_PLAN.md §3: "UNIQUE (owner_id, name) becomes
-- UNIQUE (library_id, name)". The per-library unique index shipped in
-- 20260827090000_add_exercise_libraries; the legacy constraint was kept
-- through the transition because the 1:1 owner→personal backfill made it
-- harmless. It stops being harmless with adoption (Phase 3): folding a
-- library into a club catalogue copies the moved exercises' category rows
-- into the club library — same name, same creating owner, different
-- library — which the legacy constraint forbids.
--
-- UNIQUE (library_id, name) (categories_library_name_unique) remains the
-- authoritative rule.
--
-- Rollback (only valid while no owner has same-named categories across
-- libraries):
--   ALTER TABLE categories ADD CONSTRAINT categories_owner_name_unique UNIQUE (owner_id, name);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_owner_name_unique;
