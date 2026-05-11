-- Backfill athlete_pr_history from athlete_prs.
--
-- Until now, two PR surfaces existed:
--   1. AthletePRs page (athlete profile) → wrote to athlete_prs (single 1RM per exercise).
--   2. PRTrackingPanel (sidebar /prs)     → writes to athlete_pr_history (multi-rep, time-series).
--
-- The two are now merged: PRTrackingPanel becomes the sole editing surface
-- and keeps athlete_prs in sync as the planner percentage-resolver still
-- reads from it. Backfill any existing 1RM rows from athlete_prs as the
-- starting point in the history table so coaches don't lose previously
-- entered values.

INSERT INTO athlete_pr_history (athlete_id, exercise_id, rep_count, value_kg, achieved_date)
SELECT athlete_id, exercise_id, 1, pr_value_kg, COALESCE(pr_date, CURRENT_DATE)
FROM athlete_prs
WHERE pr_value_kg IS NOT NULL
  AND pr_value_kg > 0
  AND NOT EXISTS (
    SELECT 1
    FROM athlete_pr_history h
    WHERE h.athlete_id = athlete_prs.athlete_id
      AND h.exercise_id = athlete_prs.exercise_id
      AND h.rep_count = 1
  );
