-- Soll–Ist models, model rows and saved analyses.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RECONSTRUCTED 04/08/2026 from the live schema.
--
-- These objects were applied to the remote database on 31/07/2026 via the
-- Supabase MCP server without a migration file being written, so the local
-- history had a three-migration hole (this one,
-- 20260731072042_sollist_generic_references and 20260731120008_exercise_aliases).
-- This file closes it.
--
-- It is a RECONSTRUCTION, not a transcript. It describes the schema as it
-- stands today, which is not necessarily the sequence of statements that
-- produced it — `sollist_analyses` in particular carries six dropped columns
-- (attnum 7–12), whose names Postgres does not retain, so the original
-- per-reference columns that 20260731072042 replaced with `refs jsonb` cannot
-- be recovered. Rebuilding from this folder therefore lands on the CURRENT
-- schema directly rather than re-walking the history, which is the intent.
--
-- Every statement is idempotent, so applying this to the database it was read
-- from is a no-op. The version stamp matches the entry already recorded in the
-- remote migration history, so it will not be re-run there at all.
-- ─────────────────────────────────────────────────────────────────────────────

-- A Soll–Ist model: a set of exercises, each indexed as a percentage of one of
-- the model's reference lifts. 'individual' models are captured from one
-- athlete's own numbers; 'custom' is everything else, including a fork of one
-- of the shipped textbook presets (which live in code, not here).
CREATE TABLE IF NOT EXISTS public.sollist_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'custom'
                CHECK (kind IN ('individual', 'custom')),
  athlete_id  uuid REFERENCES public.athletes(id) ON DELETE SET NULL,
  notes       text,
  -- The model's reference lifts. Generic since 20260731072042: any exercise, or
  -- a manual number the coach types. See 20260731072042_sollist_generic_references.
  refs        jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One row of a model: this exercise, at this % of that reference, for this many
-- reps. `exercise_id` is nullable — see
-- 20260803230000_sollist_model_rows_allow_unmapped for why.
CREATE TABLE IF NOT EXISTS public.sollist_model_rows (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id       uuid NOT NULL REFERENCES public.sollist_models(id) ON DELETE CASCADE,
  exercise_id    uuid REFERENCES public.exercises(id) ON DELETE CASCADE,
  ref_key        text NOT NULL,
  index_pct      numeric NOT NULL CHECK (index_pct > 0),
  reps           integer NOT NULL DEFAULT 1 CHECK (reps >= 1 AND reps <= 10),
  display_order  integer,
  UNIQUE (model_id, exercise_id, reps)
);

-- A saved sheet: which model (or shipped preset) it was built from, the
-- coach's typed-over Ist values, and the view options.
CREATE TABLE IF NOT EXISTS public.sollist_analyses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id       uuid NOT NULL,
  name           text NOT NULL,
  athlete_id     uuid REFERENCES public.athletes(id) ON DELETE CASCADE,
  -- ON DELETE SET NULL, deliberately: deleting a model must not destroy the
  -- analyses made with it. They fall back to the row snapshot in `options`.
  model_id       uuid REFERENCES public.sollist_models(id) ON DELETE SET NULL,
  -- Plain text, no FK — a shipped preset is code, not a row. Never rename the
  -- preset keys or this orphans silently.
  preset_key     text,
  ist_overrides  jsonb NOT NULL DEFAULT '{}'::jsonb,
  options        jsonb NOT NULL DEFAULT '{}'::jsonb,
  refs           jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sollist_model_rows_model_idx ON public.sollist_model_rows (model_id);
CREATE INDEX IF NOT EXISTS sollist_analyses_owner_idx   ON public.sollist_analyses (owner_id);
CREATE INDEX IF NOT EXISTS sollist_analyses_athlete_idx ON public.sollist_analyses (athlete_id);

-- Anon-open, matching every other table in this app. Real auth + RLS is a
-- later phase (CLAUDE.md, "Auth & access") — do not tighten these here.
ALTER TABLE public.sollist_models     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sollist_model_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sollist_analyses   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sollist_models', 'sollist_model_rows', 'sollist_analyses'] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', 'Allow anon to read ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)',
      'Allow anon to read ' || t, t);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', 'Allow anon to insert ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT TO anon WITH CHECK (true)',
      'Allow anon to insert ' || t, t);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', 'Allow anon to update ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE TO anon USING (true) WITH CHECK (true)',
      'Allow anon to update ' || t, t);

    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', 'Allow anon to delete ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO anon USING (true)',
      'Allow anon to delete ' || t, t);

    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated, service_role', t);
  END LOOP;
END $$;
