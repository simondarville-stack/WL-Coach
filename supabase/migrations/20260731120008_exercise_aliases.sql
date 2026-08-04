-- Remembered alternative names for an exercise.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RECONSTRUCTED 04/08/2026 from the live schema — see the header of
-- 20260731063759_sollist_models_and_analyses.sql for why.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Why it exists: the Soll–Ist textbook presets carry German
-- (Trainingsmittelkatalog) and Danish movement names, and match them against
-- the coach's own catalogue by name. When a coach repoints an unmapped row to
-- the right exercise, that correction is remembered here (see
-- src/lib/exerciseAliases.ts) so the same preset resolves it automatically next
-- time — the catalogue learns instead of asking again.
--
-- Lowercased on write; matched case-insensitively by
-- `matchCatalogueExercise` in src/lib/sollIstPresets.ts.
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.exercises.aliases IS
  'Alternative names this exercise is known by (lowercase). Taught by the coach repointing an unmapped Soll-Ist row.';
