-- Hygiene, from the Supabase advisors (08/09/2026):
--
-- 1. Eleven functions had a role-mutable search_path (security lint 0011).
--    A function without a pinned search_path resolves unqualified names in
--    whatever path the calling role has, which is how a hostile schema gets
--    a function to call the wrong thing. Pinning `public` is the fix the
--    linter asks for; every one of these only touches public tables.
--
-- 2. Twelve foreign keys had no covering index (performance lint 0001):
--    the `invited_by` / `created_by` columns on the club and sharing tables,
--    the athlete links on two KinEMOS tables, the exercise links on combo
--    items, a template link, and week_plans.last_synced_by_coach_id. A
--    delete or update on the referenced row scans the whole referencing
--    table without one.
--
-- Both additive. Rollback: DROP the indexes below; RESET search_path on
-- the functions (`ALTER FUNCTION ... RESET search_path`).

-- 1. search_path ───────────────────────────────────────────────────────────
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.set_updated_at_metrics_tables() SET search_path = public;
ALTER FUNCTION public.set_updated_at_now() SET search_path = public;
ALTER FUNCTION public.set_default_library_id() SET search_path = public;
ALTER FUNCTION public.training_log_messages_fill_from_session() SET search_path = public;
ALTER FUNCTION public.shift_macro_weeks(uuid, integer) SET search_path = public;
ALTER FUNCTION public.normalize_planned_exercise_positions(uuid, integer) SET search_path = public;
ALTER FUNCTION public.reorder_macro_tracked_exercises(uuid, uuid[]) SET search_path = public;
ALTER FUNCTION public.adopt_exercise_library(uuid, uuid, jsonb, boolean) SET search_path = public;
ALTER FUNCTION public.exercise_usage_counts(date, uuid[]) SET search_path = public;
ALTER FUNCTION public.exercise_last_used(uuid[]) SET search_path = public;

-- 2. Foreign-key indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS athlete_collaborators_invited_by_idx
  ON public.athlete_collaborators (invited_by);
CREATE INDEX IF NOT EXISTS club_members_invited_by_idx
  ON public.club_members (invited_by);
CREATE INDEX IF NOT EXISTS clubs_created_by_idx
  ON public.clubs (created_by);
CREATE INDEX IF NOT EXISTS exercise_library_members_invited_by_idx
  ON public.exercise_library_members (invited_by);
CREATE INDEX IF NOT EXISTS kinemos_device_profiles_athlete_idx
  ON public.kinemos_device_profiles (athlete_id);
CREATE INDEX IF NOT EXISTS kinemos_shares_message_idx
  ON public.kinemos_shares (message_id);
CREATE INDEX IF NOT EXISTS kinemos_training_consent_athlete_idx
  ON public.kinemos_training_consent (athlete_id);
CREATE INDEX IF NOT EXISTS planned_combo_items_exercise_idx
  ON public.planned_combo_items (exercise_id);
CREATE INDEX IF NOT EXISTS planned_combos_template_idx
  ON public.planned_combos (template_id);
CREATE INDEX IF NOT EXISTS program_template_combo_members_exercise_idx
  ON public.program_template_combo_members (exercise_id);
CREATE INDEX IF NOT EXISTS training_group_collaborators_invited_by_idx
  ON public.training_group_collaborators (invited_by);
CREATE INDEX IF NOT EXISTS week_plans_last_synced_by_coach_idx
  ON public.week_plans (last_synced_by_coach_id);
