-- exercise_last_used — the last time each exercise was planned or logged,
-- with no date window at all.
--
-- Companion to exercise_usage_counts, for the prune flow. "Unused in the last
-- 12 weeks" is not by itself a reason to archive: an exercise last programmed
-- 14 months ago is dead vocabulary, one last programmed 13 weeks ago is just
-- out of season. The counts say WHETHER it is quiet; this says HOW LONG, and
-- that is the difference between an informed archive and a guess.
--
-- NULL for either column means "never" — which is the strongest prune signal
-- there is.
--
-- Same shape as exercise_usage_counts (combo members UNIONed so a combo that
-- repeats its parent's exercise is not double-counted; not-yet-performed
-- sessions excluded; no owner filter, because a club exercise's life is
-- club-wide).
--
-- Rollback: DROP FUNCTION IF EXISTS exercise_last_used(uuid[]);

CREATE OR REPLACE FUNCTION exercise_last_used(
  p_exercise_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (exercise_id uuid, last_planned date, last_logged date)
LANGUAGE sql
STABLE
AS $$
  WITH planned AS (
    SELECT x.exercise_id, max(wp.week_start) AS d
    FROM (
      SELECT pe.id AS planned_exercise_id, pe.exercise_id, pe.weekplan_id
      FROM planned_exercises pe
      WHERE (p_exercise_ids IS NULL OR pe.exercise_id = ANY (p_exercise_ids))
      UNION
      SELECT m.planned_exercise_id, m.exercise_id, pe.weekplan_id
      FROM planned_exercise_combo_members m
      JOIN planned_exercises pe ON pe.id = m.planned_exercise_id
      WHERE (p_exercise_ids IS NULL OR m.exercise_id = ANY (p_exercise_ids))
    ) x
    JOIN week_plans wp ON wp.id = x.weekplan_id
    GROUP BY x.exercise_id
  ),
  logged AS (
    SELECT le.exercise_id, max(s.date) AS d
    FROM training_log_exercises le
    JOIN training_log_sessions s ON s.id = le.session_id
    WHERE s.status IS DISTINCT FROM 'planned'
      AND (p_exercise_ids IS NULL OR le.exercise_id = ANY (p_exercise_ids))
    GROUP BY le.exercise_id
  )
  SELECT
    coalesce(planned.exercise_id, logged.exercise_id) AS exercise_id,
    planned.d AS last_planned,
    logged.d  AS last_logged
  FROM planned
  FULL OUTER JOIN logged ON logged.exercise_id = planned.exercise_id;
$$;
