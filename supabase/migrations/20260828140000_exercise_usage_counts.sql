-- exercise_usage_counts — how often each exercise is actually used.
--
-- Feeds the "usage heat" column in the exercise tree: the catalogue answers
-- "what do I have", this answers "what do I still use", which is what turns
-- the tree from a filing cabinet into a pruning tool.
--
-- Two independent signals, because they mean different things:
--   planned_count — how often the coach PRESCRIBES it (vocabulary in use).
--   logged_count  — how often athletes RECORD it, including off-plan work.
--                   planned 0 + logged >0 is the "athletes do it, I never
--                   program it" case — precisely the row you must NOT prune.
--
-- Deliberately NOT filtered by owner/library: a club-catalogue exercise is
-- alive if ANY member's athletes use it, and a personal exercise is only ever
-- referenced by its own coach's plans, so the unfiltered count is correct for
-- both. The client passes the exercise ids it cares about.
--
-- Combos: a planned_exercise row carries an exercise_id AND may have
-- planned_exercise_combo_members rows. UNION (not UNION ALL) over
-- (planned_exercise_id, exercise_id) pairs so a combo whose member repeats
-- the parent's exercise counts once, not twice.
--
-- Rows with no usage at all are omitted — the client defaults them to zero,
-- which keeps the payload proportional to what is actually used.
--
-- Rollback: DROP FUNCTION IF EXISTS exercise_usage_counts(date, uuid[]);

CREATE OR REPLACE FUNCTION exercise_usage_counts(
  p_since        date,
  p_exercise_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (exercise_id uuid, planned_count bigint, logged_count bigint)
LANGUAGE sql
STABLE
AS $$
  WITH planned AS (
    SELECT p.exercise_id, count(*)::bigint AS n
    FROM (
      SELECT pe.id AS planned_exercise_id, pe.exercise_id
      FROM planned_exercises pe
      JOIN week_plans wp ON wp.id = pe.weekplan_id
      WHERE wp.week_start >= p_since
        AND (p_exercise_ids IS NULL OR pe.exercise_id = ANY (p_exercise_ids))
      UNION
      SELECT m.planned_exercise_id, m.exercise_id
      FROM planned_exercise_combo_members m
      JOIN planned_exercises pe ON pe.id = m.planned_exercise_id
      JOIN week_plans wp ON wp.id = pe.weekplan_id
      WHERE wp.week_start >= p_since
        AND (p_exercise_ids IS NULL OR m.exercise_id = ANY (p_exercise_ids))
    ) p
    GROUP BY p.exercise_id
  ),
  logged AS (
    SELECT le.exercise_id, count(*)::bigint AS n
    FROM training_log_exercises le
    JOIN training_log_sessions s ON s.id = le.session_id
    -- status 'planned' marks a not-yet-performed session (see analysis fetch).
    WHERE s.date >= p_since
      AND s.status IS DISTINCT FROM 'planned'
      AND (p_exercise_ids IS NULL OR le.exercise_id = ANY (p_exercise_ids))
    GROUP BY le.exercise_id
  )
  SELECT
    coalesce(planned.exercise_id, logged.exercise_id) AS exercise_id,
    coalesce(planned.n, 0) AS planned_count,
    coalesce(logged.n, 0)  AS logged_count
  FROM planned
  FULL OUTER JOIN logged ON logged.exercise_id = planned.exercise_id;
$$;
