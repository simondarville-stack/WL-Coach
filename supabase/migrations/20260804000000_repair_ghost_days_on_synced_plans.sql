-- Remove the empty "ghost" training units that group sync used to create.
--
-- WRONG: until 0.33.0, `syncGroupPlanToAthletes` created an athlete's week plan
-- with no `active_days`, so the row inherited the column default
-- ARRAY[1,2,3,4,5]. A group training three units therefore handed every member
-- two extra unit cards — empty, unnamed, and permanent, because the sync only
-- ever ADDS days. 0.33.0 fixed the creation path (`seedStructureFromGroup`),
-- but that is forward-only; this repairs the plans already carrying them.
--
-- THE RULE, deliberately conservative: a day is removed only when the group
-- plan it is linked to does not train it AND it holds nothing whatsoever —
--   * no planned_exercises,
--   * no training_log_sessions,
--   * no coach-typed day label,
--   * no day_schedule entry.
-- Anything else is the athlete's own extra unit and is left alone. Measured on
-- production before writing this: 10 candidate slots, of which 9 are empty
-- ghosts and 1 is real — Asger Søderberg's "Friday" on 25/05/2026, which
-- carries 5 planned rows and a completed session. This migration must not
-- touch it.
--
-- Removing a day is not the same as deleting content: `active_days` is only the
-- list of units the week shows. Nothing here deletes a planned exercise or a
-- log, and the guard above means there is nothing on these days to delete.
-- A coach who wants the unit back just re-adds it.
--
-- Idempotent: re-running finds no candidates.

WITH ghost AS (
  SELECT a.id AS plan_id, d AS day_index
  FROM week_plans g
  JOIN week_plans a ON a.source_group_plan_id = g.id
  CROSS JOIN LATERAL unnest(a.active_days) AS d
  WHERE g.is_group_plan
    AND d <> ALL(g.active_days)
    -- nothing planned on it
    AND NOT EXISTS (
      SELECT 1 FROM planned_exercises pe
      WHERE pe.weekplan_id = a.id AND pe.day_index = d)
    -- nothing logged on it
    AND NOT EXISTS (
      SELECT 1 FROM training_log_sessions s
      WHERE s.athlete_id = a.athlete_id
        AND s.week_start = a.week_start
        AND s.day_index = d)
    -- no name the coach or athlete typed
    AND nullif(btrim(coalesce(a.day_labels ->> d::text, '')), '') IS NULL
    -- no weekday/time set for it.
    -- coalesce matters: `NULL ? 'x'` is NULL, not false, and would make the
    -- whole predicate NULL and silently match nothing.
    AND NOT (coalesce(a.day_schedule, '{}'::jsonb) ? d::text)
),
per_plan AS (
  SELECT plan_id, array_agg(day_index) AS drop_days
  FROM ghost GROUP BY plan_id
)
UPDATE week_plans wp
SET active_days = ARRAY(
      SELECT d FROM unnest(wp.active_days) AS d
      WHERE d <> ALL(p.drop_days) ORDER BY d),
    -- Keep the explicit render order consistent. A stale entry would be
    -- filtered by `visibleDays` anyway, but leaving it invites the next reader
    -- to trust it.
    day_display_order = CASE
      WHEN wp.day_display_order IS NULL THEN NULL
      ELSE ARRAY(
        SELECT d FROM unnest(wp.day_display_order) AS d
        WHERE d <> ALL(p.drop_days))
    END
FROM per_plan p
WHERE wp.id = p.plan_id;
