-- Macro templates — save a whole macro cycle as a reusable model.
--
-- A template is a self-contained JSONB document (weeks rhythm, phases,
-- tracked exercises with their target series), saved in one of two modes:
--   'kg'  — exact copy: loads stored in kilograms.
--   'pct' — general model: every load stored as % of its exercise's
--           reference, so the template re-anchors to any athlete or a
--           future, higher level. Reps and Σreps stay absolute counts.
--
-- payload shape (see src/lib/macroTemplate.ts):
--   { weeks:    [{ week_number, week_type, week_type_text, total_reps_target }],
--     phases:   [{ name, phase_type, start_week_number, end_week_number, color, notes, position }],
--     exercises:[{ exercise_id, exercise_name, position, reference_kg,
--                  targets: [{ week_number, max, avg, reps, reps_at_max, sets_at_max, note }] }] }
--
-- Follows the owner_id pattern (future auth/RLS phase needs no schema surgery).

CREATE TABLE IF NOT EXISTS macro_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('kg', 'pct')),
  week_count integer NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS macro_templates_owner_idx ON macro_templates (owner_id);

COMMENT ON TABLE macro_templates IS
  'Saved macro-cycle models. mode=pct stores loads as % of each exercise reference (general model).';
