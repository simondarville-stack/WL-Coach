-- Macro fill guide — foundations (all additive).
--
-- 1. macro_targets.note            — per-week per-exercise coach note ("Go for a 3RM this week").
--                                    A target row may exist with only a note (all targets NULL).
-- 2. macro_tracked_exercises.reference_kg
--                                  — per-exercise reference for %-anchored fills and templates
--                                    (PR / competition target). NULL = not set; UI may fall back
--                                    to the athlete's best logged result.
-- 3. macrocycles.table_layout     — per-macro view config (collapsed/expanded/hidden/graphed
--                                    exercise columns, metric order + visibility, view toggles).
--                                    NULL = application defaults.
-- 4. general_settings.rhythm_presets
--                                  — coach-defined fill-guide rhythm presets. NULL = app defaults
--                                    (same convention as week_types / phase_type_presets).
--                                    Shape: [{ id, name, mode: 'weektype'|'pattern',
--                                              mult?: { [weekTypeAbbr]: {load, reps} },
--                                              pattern?: [{load, reps}], stampTypes?: (string|null)[] }]
--                                    load/reps are % of the interpolated trend.

ALTER TABLE macro_targets
  ADD COLUMN IF NOT EXISTS note text NULL;

COMMENT ON COLUMN macro_targets.note IS
  'Coach note for this exercise+week (e.g. "Go for a 3RM this week"). Row may hold only a note.';

ALTER TABLE macro_tracked_exercises
  ADD COLUMN IF NOT EXISTS reference_kg numeric NULL;

COMMENT ON COLUMN macro_tracked_exercises.reference_kg IS
  'Reference load (kg) for %-anchored fills and general-model templates. NULL = unset.';

ALTER TABLE macrocycles
  ADD COLUMN IF NOT EXISTS table_layout jsonb NULL;

COMMENT ON COLUMN macrocycles.table_layout IS
  'Per-macro table view config: exercise column states, metric order/visibility, view toggles. NULL = app defaults.';

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS rhythm_presets jsonb NULL;

COMMENT ON COLUMN general_settings.rhythm_presets IS
  'Coach-defined fill-guide rhythm presets. NULL = use app defaults (DEFAULT_RHYTHM_PRESETS).';
