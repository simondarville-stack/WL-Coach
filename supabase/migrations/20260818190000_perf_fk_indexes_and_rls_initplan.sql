-- Performance housekeeping (docs/PERFORMANCE_REVIEW.md, section F).
-- Applied to the live project via MCP apply_migration on 18/08/2026.
--
-- 1) Covering indexes for foreign keys on hot join paths flagged by the
--    Supabase advisor (unindexed_foreign_keys). Cheap now, and they keep
--    planner/log/analysis joins and parent-row deletes from degrading as
--    data grows. FKs on tiny, rarely-joined tables (collaborator invited_by)
--    are deliberately skipped, as are tables the advisor also lists as
--    already carrying an (unused) index on the same column.

CREATE INDEX IF NOT EXISTS idx_planned_exercises_exercise ON public.planned_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_pe_combo_members_planned ON public.planned_exercise_combo_members (planned_exercise_id);
CREATE INDEX IF NOT EXISTS idx_pe_combo_members_exercise ON public.planned_exercise_combo_members (exercise_id);
CREATE INDEX IF NOT EXISTS idx_planned_exercise_media_planned ON public.planned_exercise_media (planned_exercise_id);
CREATE INDEX IF NOT EXISTS idx_training_log_exercises_exercise ON public.training_log_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_training_log_messages_exercise ON public.training_log_messages (exercise_id);
CREATE INDEX IF NOT EXISTS idx_training_log_messages_sender_coach ON public.training_log_messages (sender_coach_id);
CREATE INDEX IF NOT EXISTS idx_athlete_pr_history_exercise ON public.athlete_pr_history (exercise_id);
CREATE INDEX IF NOT EXISTS idx_week_plans_source_group_plan ON public.week_plans (source_group_plan_id);
CREATE INDEX IF NOT EXISTS idx_week_plans_last_edited_by ON public.week_plans (last_edited_by_coach_id);
CREATE INDEX IF NOT EXISTS idx_macro_phases_macrocycle ON public.macro_phases (macrocycle_id);
CREATE INDEX IF NOT EXISTS idx_macro_competitions_macrocycle ON public.macro_competitions (macrocycle_id);
CREATE INDEX IF NOT EXISTS idx_macro_competitions_event ON public.macro_competitions (event_id);
CREATE INDEX IF NOT EXISTS idx_macrocycles_primary_event ON public.macrocycles (primary_event_id);
CREATE INDEX IF NOT EXISTS idx_macro_tracked_exercises_exercise ON public.macro_tracked_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_event_athletes_athlete ON public.event_athletes (athlete_id);
CREATE INDEX IF NOT EXISTS idx_exercises_pr_reference ON public.exercises (pr_reference_exercise_id);
CREATE INDEX IF NOT EXISTS idx_sollist_models_athlete ON public.sollist_models (athlete_id);
CREATE INDEX IF NOT EXISTS idx_sollist_model_rows_exercise ON public.sollist_model_rows (exercise_id);
CREATE INDEX IF NOT EXISTS idx_sollist_analyses_model ON public.sollist_analyses (model_id);
CREATE INDEX IF NOT EXISTS idx_program_template_exercises_exercise ON public.program_template_exercises (exercise_id);
CREATE INDEX IF NOT EXISTS idx_program_template_combo_members_exercise ON public.program_template_combo_members (exercise_id);

-- 2) auth_rls_initplan: rewrite athlete-facing policies so auth.uid() is
--    evaluated ONCE per statement ((SELECT auth.uid())) instead of once per
--    row. Semantically identical; policy names, roles and scope unchanged.
--    (The overlapping-permissive-policies advisor finding is deliberately
--    NOT addressed here — consolidating policies changes access semantics
--    and belongs to the future auth/RLS phase.)

ALTER POLICY "Athletes can read own profile via auth" ON public.athletes
  USING (auth_user_id = (SELECT auth.uid()));

ALTER POLICY "Athletes can update own profile via auth" ON public.athletes
  USING (auth_user_id = (SELECT auth.uid()))
  WITH CHECK (auth_user_id = (SELECT auth.uid()));

ALTER POLICY "Authenticated athletes can read their PRs" ON public.athlete_prs
  USING (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())));

ALTER POLICY "Authenticated athletes can read their bodyweight" ON public.bodyweight_entries
  USING (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())));

ALTER POLICY "Authenticated athletes can insert bodyweight" ON public.bodyweight_entries
  WITH CHECK (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())));

ALTER POLICY "Authenticated athletes can read macrocycles" ON public.macrocycles
  USING (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())));

ALTER POLICY "Authenticated athletes can read macro weeks" ON public.macro_weeks
  USING (macrocycle_id IN (SELECT macrocycles.id FROM macrocycles WHERE macrocycles.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))));

ALTER POLICY "Authenticated athletes can read macro phases" ON public.macro_phases
  USING (macrocycle_id IN (SELECT macrocycles.id FROM macrocycles WHERE macrocycles.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))));

ALTER POLICY "Authenticated athletes can read macro competitions" ON public.macro_competitions
  USING (macrocycle_id IN (SELECT macrocycles.id FROM macrocycles WHERE macrocycles.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))));

ALTER POLICY "Authenticated athletes can read their week plans" ON public.week_plans
  USING (
    (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())))
    OR (group_id IN (
      SELECT group_members.group_id FROM group_members
      WHERE group_members.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
        AND group_members.left_at IS NULL
    ))
  );

ALTER POLICY "Authenticated athletes can read their planned exercises" ON public.planned_exercises
  USING (weekplan_id IN (
    SELECT week_plans.id FROM week_plans
    WHERE week_plans.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
  ));

ALTER POLICY "Authenticated athletes can read their set lines" ON public.planned_set_lines
  USING (planned_exercise_id IN (
    SELECT pe.id FROM planned_exercises pe
    JOIN week_plans wp ON wp.id = pe.weekplan_id
    WHERE wp.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
  ));

ALTER POLICY "Authenticated athletes can manage their training log sessions" ON public.training_log_sessions
  USING (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())))
  WITH CHECK (athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid())));

ALTER POLICY "Authenticated athletes can manage their training log exercises" ON public.training_log_exercises
  USING (session_id IN (
    SELECT training_log_sessions.id FROM training_log_sessions
    WHERE training_log_sessions.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
  ))
  WITH CHECK (session_id IN (
    SELECT training_log_sessions.id FROM training_log_sessions
    WHERE training_log_sessions.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
  ));

ALTER POLICY "Authenticated athletes can manage their training log sets" ON public.training_log_sets
  USING (log_exercise_id IN (
    SELECT tle.id FROM training_log_exercises tle
    JOIN training_log_sessions tls ON tls.id = tle.session_id
    WHERE tls.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
  ))
  WITH CHECK (log_exercise_id IN (
    SELECT tle.id FROM training_log_exercises tle
    JOIN training_log_sessions tls ON tls.id = tle.session_id
    WHERE tls.athlete_id IN (SELECT athletes.id FROM athletes WHERE athletes.auth_user_id = (SELECT auth.uid()))
  ));
