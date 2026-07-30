-- planned_exercises.position orders the exercises inside one training unit.
-- Every "add exercise" call site computed the new position as
-- `exercises.length + 1` from the React render's snapshot, so adding two
-- exercises before the refetch landed gave both the same number. There is no
-- unique index on (weekplan_id, day_index, position), so this failed silently:
-- tied rows come back from Postgres in arbitrary order, and a coach's day could
-- re-shuffle between loads. The group sync then copied the group plan's ties
-- out to every athlete in the group, which is why the same collision appears on
-- five plans at once.
--
-- Appends now resolve the position from the database (useWeekPlans
-- .nextPositionInDay), so no new ties are created. This repairs the existing
-- ones.
--
-- Scoped to the 19 (weekplan_id, day_index) pairs that actually contain a tie —
-- days that merely have gaps (1,2,4,7) are left alone, since gaps order fine.
-- Within a repaired day the current order is preserved; created_at then id
-- break the tie deterministically. No rows are added or removed.
WITH dup_days AS (
  SELECT DISTINCT weekplan_id, day_index
  FROM planned_exercises
  GROUP BY weekplan_id, day_index, position
  HAVING COUNT(*) > 1
),
ranked AS (
  SELECT pe.id,
         ROW_NUMBER() OVER (
           PARTITION BY pe.weekplan_id, pe.day_index
           ORDER BY pe.position, pe.created_at, pe.id
         ) AS new_pos,
         pe.position AS old_pos
  FROM planned_exercises pe
  JOIN dup_days d
    ON d.weekplan_id = pe.weekplan_id AND d.day_index = pe.day_index
)
UPDATE planned_exercises pe
SET position = r.new_pos
FROM ranked r
WHERE pe.id = r.id AND r.new_pos <> r.old_pos;
