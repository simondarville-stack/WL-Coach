-- Renumber planned_exercises.position densely (1..n) within each training unit
-- of a week plan, preserving the current order.
--
-- Why a function: the client normalized by issuing one UPDATE per row after a
-- SELECT. A group sync touches every athlete × every day, so that is ~100
-- round trips bolted onto an already-heavy operation, and it is not atomic —
-- a failure part-way leaves the day half-renumbered.
--
-- Ordering rule: (position, created_at, id). Position carries the intended
-- order; created_at breaks a tie in favour of the row that existed first,
-- which on a synced day means a coach's individual row sorts ahead of a
-- freshly-copied group row. id is the final deterministic tiebreak.
--
-- Only rows whose number actually changes are written, so a day that is
-- already dense costs nothing and no spurious updated_at churn is produced.
--
-- p_day_index NULL = every unit in the plan; otherwise just that unit.
--
-- planned_exercises has NO unique index on (weekplan_id, day_index, position),
-- so this single-statement renumber cannot trip a constraint mid-flight the
-- way an ordered swap would.
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
             PARTITION BY day_index
             ORDER BY position, created_at, id
           ) AS new_pos
    FROM planned_exercises
    WHERE weekplan_id = p_weekplan_id
      AND (p_day_index IS NULL OR day_index = p_day_index)
  ),
  updated AS (
    UPDATE planned_exercises pe
    SET position = r.new_pos
    FROM ranked r
    WHERE pe.id = r.id AND r.new_pos <> r.old_pos
    RETURNING pe.id
  )
  SELECT count(*) INTO v_changed FROM updated;
  RETURN v_changed;
END;
$$;
