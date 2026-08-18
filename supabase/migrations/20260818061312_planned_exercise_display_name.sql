-- Per-instance display name for a planned exercise.
--
-- A coach writing a variation ("Snatch from blocks") wants that row to read
-- differently in ONE week without forking the catalogue exercise — every set,
-- log and analysis row must stay attached to the original exercise_id so the
-- history keeps accumulating in one place.
--
-- NULL means "use the catalogue name", which is what every existing row wants,
-- so no backfill. Combos already carry their own name in combo_notation; this
-- column is the equivalent for a plain exercise row, and the planner's name
-- editor writes whichever of the two applies to the row it is editing.
alter table planned_exercises
  add column if not exists display_name text;

comment on column planned_exercises.display_name is
  'Coach override for this planned row''s displayed name. NULL = use exercises.name. Never affects exercise_id, so all logged/analysis data stays under the original exercise.';
