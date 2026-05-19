-- Adds a generic jsonb metadata bag to training_log_exercises so the
-- athlete client can persist row-level extras without further schema
-- churn. First consumer: `removed_set_numbers` — the athlete may
-- delete a planned set that was never touched (e.g. coach prescribed
-- 5, athlete chose to only do 4). We need to remember the omission
-- across reloads, but the planned_set_lines belong to the shared
-- prescription and must not be mutated.
--
-- Shape (loose; client-validated):
--   {
--     "removed_set_numbers": [4, 5]
--   }
--
-- Future consumers (planned): GPP table athlete state, technique
-- checkboxes, ad-hoc fields. Keeping it a single jsonb avoids one
-- migration per future field.

alter table training_log_exercises
  add column if not exists metadata jsonb not null default '{}'::jsonb;

comment on column training_log_exercises.metadata is
  'Athlete-side bag for row-level state that does not warrant its own column. See client docs in src/lib/trainingLogService.ts.';
