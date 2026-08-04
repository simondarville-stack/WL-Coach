-- Generic Soll–Ist references: any exercise, or a number the coach types.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RECONSTRUCTED 04/08/2026 from the live schema — see the header of
-- 20260731063759_sollist_models_and_analyses.sql for why, and for the limits of
-- the reconstruction.
--
-- What this migration originally did: a model's references used to be fixed
-- columns (snatch / clean & jerk), which is why `sollist_analyses` carries six
-- dropped columns at attnum 7–12. It replaced them with a `refs jsonb` array so
-- a model can anchor on ANY exercise — or on a manual number, for a lift the
-- athlete has no PR row for. Postgres does not retain the names of dropped
-- columns, so the DROP statements cannot be recovered; on the live database
-- they are long since applied, and a database rebuilt from this folder never
-- creates those columns in the first place.
--
-- What remains reproducible, and is therefore what this file asserts, is the
-- end state: both tables carry `refs`.
-- ─────────────────────────────────────────────────────────────────────────────

-- Shape of each element (see SollIstRef in src/lib/sollIst.ts):
--   { key, label, exerciseId }   exerciseId null = a manual reference, whose
--                                numbers the coach types on the sheet.
ALTER TABLE public.sollist_models
  ADD COLUMN IF NOT EXISTS refs jsonb NOT NULL DEFAULT '[]'::jsonb;

-- A saved analysis keeps its OWN copy of the refs rather than reading the
-- model's, so re-opening it shows the numbers as they were when it was saved.
ALTER TABLE public.sollist_analyses
  ADD COLUMN IF NOT EXISTS refs jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.sollist_models.refs IS
  'Reference lifts a model indexes against: [{ key, label, exerciseId }]. exerciseId null = manual reference.';
COMMENT ON COLUMN public.sollist_analyses.refs IS
  'Snapshot of the refs (and their values) at save time, so a reopened analysis is stable.';
