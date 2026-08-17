-- Per-exercise toggle for the planner's individual analysis column
-- (R / S / Hi / Ø on the right of each row). Backfill rule per product
-- decision: existing exercises show the summary only when they count
-- towards totals; new exercises default to showing it.
alter table exercises
  add column if not exists show_planner_summary boolean not null default true;

update exercises set show_planner_summary = counts_towards_totals;
