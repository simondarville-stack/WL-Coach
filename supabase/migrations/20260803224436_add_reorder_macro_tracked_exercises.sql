-- Reorder a macrocycle's tracked exercises to an explicit id order, atomically.
--
-- Why an RPC: macro_tracked_exercises carries UNIQUE (macrocycle_id, position),
-- so a client-side loop of single UPDATEs collides the moment two rows pass
-- each other — the same 23505 the ← / → arrow swap had to work around by
-- parking one row on a negative sentinel. Drag-reorder moves a column past
-- several others at once, so the swap primitive no longer covers it.
--
-- Two phases inside one transaction:
--   A. park every row of the cycle on -1 - position. Positions are
--      non-negative, so the parked values are unique among themselves and
--      cannot collide with any live row.
--   B. write the final 0-based positions from the caller's ordering.
-- The guard runs first and RAISEs on a mismatch; because the whole function is
-- one transaction, that rolls back the parking step and leaves no row parked.
--
-- 0-based to match addTrackedExercise, which returns (max(position) ?? -1) + 1.
CREATE OR REPLACE FUNCTION reorder_macro_tracked_exercises(
  p_macrocycle_id uuid,
  p_ordered_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_total integer;
  v_given integer;
  v_matched integer;
BEGIN
  v_given := COALESCE(array_length(p_ordered_ids, 1), 0);

  SELECT count(*) INTO v_total
  FROM macro_tracked_exercises
  WHERE macrocycle_id = p_macrocycle_id;

  IF v_given <> v_total THEN
    RAISE EXCEPTION
      'reorder_macro_tracked_exercises: got % ids for a cycle with % tracked exercises',
      v_given, v_total;
  END IF;

  -- Every id must belong to this cycle (and, with the count check above and a
  -- unique primary key, that also rules out duplicates in the input).
  SELECT count(DISTINCT id) INTO v_matched
  FROM macro_tracked_exercises
  WHERE macrocycle_id = p_macrocycle_id
    AND id = ANY(p_ordered_ids);

  IF v_matched <> v_given THEN
    RAISE EXCEPTION
      'reorder_macro_tracked_exercises: % of % ids do not belong to this cycle (or repeat)',
      v_given - v_matched, v_given;
  END IF;

  -- Phase A — park.
  UPDATE macro_tracked_exercises
  SET position = -1 - position
  WHERE macrocycle_id = p_macrocycle_id;

  -- Phase B — land on the requested order.
  UPDATE macro_tracked_exercises m
  SET position = r.new_pos
  FROM (
    SELECT t.id, t.ord - 1 AS new_pos
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS t(id, ord)
  ) r
  WHERE m.id = r.id
    AND m.macrocycle_id = p_macrocycle_id;

  RETURN v_given;
END;
$$;

REVOKE ALL ON FUNCTION reorder_macro_tracked_exercises(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reorder_macro_tracked_exercises(uuid, uuid[])
  TO anon, authenticated, service_role;
