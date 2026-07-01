-- Add parent_exercise_id to exercises for parent–child (tree) hierarchies.
--
-- A nullable self-referencing FK: a child exercise (e.g. "Snatch from low hang")
-- points at its parent (e.g. "Snatch from hang"). Trees are a PURE CATALOGUE
-- concept — plans (planned_exercises) and logs (training_log_exercises) keep
-- referencing the specific child's exercise_id and resolve the parent live at
-- read time, so re-parenting retroactively re-rolls history and no plan/log
-- table changes are needed. Mirrors the existing pr_reference_exercise_id
-- self-FK precedent (20260406_metrics_rename_and_k_value.sql).
--
-- ON DELETE SET NULL: removing/detaching a parent orphans its children to root,
-- never cascades — a parent change never destroys child rows or their history.
--
-- Multi-hop cycles (A→B→A) cannot be expressed in a CHECK; they are guarded in
-- the app layer (src/lib/exerciseHierarchy.ts + the exercise form / drag
-- picker). Owner-match (child and parent share owner_id) is likewise app-
-- enforced (RLS is deferred). The CHECK below only blocks the trivial
-- self-parent case. The DO block keeps the constraint add idempotent/re-runnable.
--
-- Apply with: supabase db push (user must apply — migrations are gated).

alter table public.exercises
  add column if not exists parent_exercise_id uuid
    references public.exercises(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exercises_no_self_parent'
  ) then
    alter table public.exercises
      add constraint exercises_no_self_parent check (parent_exercise_id <> id);
  end if;
end $$;

create index if not exists idx_exercises_parent
  on public.exercises(parent_exercise_id)
  where parent_exercise_id is not null;

comment on column public.exercises.parent_exercise_id is
  'Optional self-FK to the parent exercise for catalogue trees; NULL = root. Children roll up into the parent for analysis/planner totals while still being planned/logged as their own variation. ON DELETE SET NULL. Cycle + owner-match guards are app-layer (src/lib/exerciseHierarchy.ts).';
