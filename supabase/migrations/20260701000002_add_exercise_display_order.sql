-- Add display_order to exercises for manual sibling ordering in the tree view.
--
-- Nullable: existing exercises have no explicit order (NULL) and fall back to a
-- name sort after any ordered siblings. A coach dragging exercises within a
-- parent/category in the catalogue tree assigns 0..n to that sibling group.
-- Purely a display concern (catalogue tree); analysis/planner ignore it.
--
-- Apply with: supabase db push (user must apply — migrations are gated).

alter table public.exercises
  add column if not exists display_order integer;

comment on column public.exercises.display_order is
  'Optional manual sort order within a parent/category for the catalogue tree view. NULL sorts after ordered siblings, then by name. Display-only.';
