-- Exercise features: soft-load comparators and rep/set ranges on planned set
-- lines. `reps` / `sets` keep holding the LOWER bound so every existing
-- consumer (athlete row expansion, expectedPlannedSetCount) keeps working and
-- the athlete is guaranteed at least the minimum; `reps_max` / `sets_max`
-- carry the range upper bound (null = fixed value, mirroring load_max).
-- `load_cmp` is the soft-load comparator (>= work up to / ~ around / <= stay
-- below), stored in ASCII; display glyphs (>= -> ≥ etc.) are a UI concern.
alter table planned_set_lines
  add column if not exists reps_max integer,
  add column if not exists sets_max integer,
  add column if not exists load_cmp text;

alter table planned_set_lines
  add constraint planned_set_lines_reps_max_check
    check (reps_max is null or reps_max >= reps),
  add constraint planned_set_lines_sets_max_check
    check (sets_max is null or sets_max >= sets),
  add constraint planned_set_lines_load_cmp_check
    check (load_cmp is null or load_cmp in ('>=', '~', '<='));
