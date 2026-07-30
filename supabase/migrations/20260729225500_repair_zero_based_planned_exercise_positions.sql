-- planned_exercises.position is 1-based everywhere in the app, but
-- applyTemplateDayToPlanDay computed its base as `count ?? 0` — so applying a
-- template to a CLEARED day produced a 0-based day, and appending to a day of
-- n rows started at n and collided with the row already there.
--
-- 25 rows across 25 days are 0-based in production. Every one of them is a
-- clean 0,1,2 sequence (no ties), so renumbering to 1,2,3 preserves the coach's
-- order exactly — it only shifts the day onto the same base as every other day.
--
-- The client-side cause is fixed in the same change (templateService now takes
-- max(position)+1), so this is a one-off repair.
--
-- Reuses normalize_planned_exercise_positions, which renumbers densely from 1
-- and only writes rows that actually move.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT weekplan_id, day_index
    FROM planned_exercises
    WHERE position = 0
  LOOP
    PERFORM normalize_planned_exercise_positions(r.weekplan_id, r.day_index);
  END LOOP;
END $$;
