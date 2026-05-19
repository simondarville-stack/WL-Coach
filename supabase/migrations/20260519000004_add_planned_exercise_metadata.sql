-- General Physical Preparation (GPP) sentinel exercise support.
--
-- A GPP block is a structured supplementary section the coach can drop
-- into any day's plan: title, optional description, and a table of
-- (exercise, reps, sets, optional load) rows. Use cases: circuit
-- training, crossfit-style conditioning, mobility flows, accessory
-- supersets that don't warrant individual planned_exercises rows.
--
-- The shape is stored as JSON under planned_exercises.metadata.gpp:
--   {
--     "title":       "Conditioning",
--     "description": "3 rounds for time",
--     "rows": [
--       { "exercise": "Box jumps", "reps": "12",     "sets": 3, "load": "" },
--       { "exercise": "KB swings", "reps": "15",     "sets": 3, "load": "24 kg" },
--       { "exercise": "Plank",     "reps": "30 sec", "sets": 3, "load": "" }
--     ]
--   }
--
-- Athlete-side state (which rows are checked off, athlete edits) lives
-- in training_log_exercises.metadata.gpp under the same shape with an
-- added "done" boolean per row.

alter table planned_exercises
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column planned_exercises.metadata is
  'Per-row planner extras that do not warrant their own column. Currently consumed by the GPP sentinel (metadata.gpp).';
