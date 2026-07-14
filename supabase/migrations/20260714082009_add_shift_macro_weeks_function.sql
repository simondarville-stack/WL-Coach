-- Atomic, collision-safe shift of a macrocycle's macro_weeks.week_start values.
--
-- (macrocycle_id, week_start) is UNIQUE and non-deferrable, so a bulk
-- "week_start = week_start + N" (or parallel per-row updates) fails when weeks
-- slide onto each other's slots — and, run as separate transactions, can leave
-- a PARTIAL shift committed (observed corruption: gaps + misaligned starts).
--
-- Updating in a collision-safe order — latest week first when moving forward,
-- earliest first when moving back — keeps every target slot free at update
-- time. Running it inside one function call makes the whole shift ATOMIC:
-- any failure rolls back every row, so no partial shift can ever persist.
CREATE OR REPLACE FUNCTION public.shift_macro_weeks(p_cycle_id uuid, p_shift_days integer)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE r RECORD;
BEGIN
  IF p_shift_days = 0 THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT id, week_start
    FROM public.macro_weeks
    WHERE macrocycle_id = p_cycle_id
    ORDER BY CASE WHEN p_shift_days > 0 THEN week_start END DESC NULLS LAST, week_start ASC
  LOOP
    UPDATE public.macro_weeks
    SET week_start = r.week_start + p_shift_days
    WHERE id = r.id;
  END LOOP;
END;
$$;
