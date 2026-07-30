-- Hardening pass on normalize_planned_exercise_positions.
--
-- 1. created_at is NULLABLE on planned_exercises. A NULL sorts LAST under the
--    default ORDER BY, so a row with no timestamp would be pushed to the end of
--    its tie group instead of staying where its position put it. COALESCE to
--    -infinity keeps it ordered by position first, as intended.
-- 2. `new_pos <> old_pos` is NULL-unsafe if position were ever NULL; IS DISTINCT
--    FROM makes the guard total.
-- 3. PARTITION BY weekplan_id, day_index rather than day_index alone. The WHERE
--    already scopes to one plan so the result is identical, but the window then
--    states its own invariant instead of depending on the caller's filter.
-- 4. Explicit grants: the app calls this as `anon`.
--
-- Deliberately NOT marked STRICT: p_day_index IS NULL is the meaningful
-- "every unit in the plan" case, and STRICT would make that call return NULL.
CREATE OR REPLACE FUNCTION normalize_planned_exercise_positions(
  p_weekplan_id uuid,
  p_day_index integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_changed integer;
BEGIN
  WITH ranked AS (
    SELECT id,
           position AS old_pos,
           ROW_NUMBER() OVER (
             PARTITION BY weekplan_id, day_index
             ORDER BY position,
                      COALESCE(created_at, '-infinity'::timestamptz),
                      id
           ) AS new_pos
    FROM public.planned_exercises
    WHERE weekplan_id = p_weekplan_id
      AND (p_day_index IS NULL OR day_index = p_day_index)
  ),
  updated AS (
    UPDATE public.planned_exercises pe
    SET position = r.new_pos
    FROM ranked r
    WHERE pe.id = r.id
      AND r.new_pos IS DISTINCT FROM r.old_pos
    RETURNING pe.id
  )
  SELECT count(*) INTO v_changed FROM updated;
  RETURN v_changed;
END;
$$;

REVOKE ALL ON FUNCTION normalize_planned_exercise_positions(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION normalize_planned_exercise_positions(uuid, integer)
  TO anon, authenticated, service_role;
