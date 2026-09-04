-- Backfill the combo rep TUPLE onto sets that were logged with the one-tap ✓.
--
-- A combo prescription ("90×1+1+1×3") stores the tuple in
-- planned_set_lines.reps_text and only its SUM in .reps. Until 0.89.0 the
-- athlete's one-tap ✓ (and "Log as prescribed") copied the sum into
-- performed_reps and left performed_text NULL, so a clean + 2 jerks was
-- recorded — and shown on every coach surface — as "3". The client now writes
-- the tuple; this recovers it for everything logged before that.
--
-- What is safe to infer, and what is not
-- -------------------------------------
-- A set is backfilled only where the prescription can name its split without
-- guessing. Three conditions, all required:
--
--   1. The tuple's SUM equals the row's performed_reps. This is the load-
--      bearing one: it proves the athlete accepted the prescription rather
--      than typing their own number. Where the two differ we cannot know the
--      split — Asger, 27/08, logged 4 against a prescribed "1+2+2" (5) — and
--      inventing one would put a lift in the record that never happened.
--
--   2. No OTHER line of the same prescription shares that sum with a
--      different tuple. Guards the case where two lines sum alike
--      ("80×2+1×2, 90×1+2×2") and the sum alone cannot say which was done.
--
--   3. For a set inside the planned count, the matched line must also be the
--      one that set_number lands on — numbered exactly the way
--      expandSetLines() numbers the athlete's rows: lines in `position`
--      order, each contributing `sets` rows (the LOWER bound of a set range —
--      the guaranteed minimum the athlete gets pre-built), counting from 1.
--      Rows the athlete deleted are not renumbered (metadata.removed_set_
--      numbers only hides them), so the mapping survives them.
--
--      Past the planned count the athlete pressed "Add set", so position
--      carries no information and this condition is waived — 1 and 2 alone
--      decide. Those extras are real work: Ida's 6th and 7th sets at 85 kg on
--      a prescription whose only cluster is 1+1+1.
--
-- On this database that backfills 915 of 937 candidate sets. The 22 skipped
-- are the honest remainder: 17 where the reps match no prescribed cluster
-- (singles and doubles taken off-script), and 5 where conditions 1/2 fail.
--
-- Athlete-authored off-plan combos (metadata.combo, no planned_exercise_id)
-- are NOT backfillable at all: there is no prescription to recover a split
-- from, and their value-less ✓ stored no reps in the first place.
--
-- Only NULLs are filled — no logged value is ever overwritten, so re-running
-- is a no-op. performed_reps is deliberately untouched: it stays the sum, and
-- every tonnage/volume/PR path keeps reading it. The set_updated_at trigger
-- moves updated_at on the touched rows; nothing in the app reads that column.
--
-- Verify before/after:
--   SELECT count(*) FROM training_log_sets ls
--     JOIN training_log_exercises le ON le.id = ls.log_exercise_id
--     JOIN planned_exercises pe ON pe.id = le.planned_exercise_id
--    WHERE pe.is_combo AND ls.performed_text IS NULL
--      AND ls.performed_reps IS NOT NULL;
--
-- Rollback: re-run this file's CTEs and null those ids back out —
--   ... UPDATE training_log_sets ls SET performed_text = NULL
--       FROM target t WHERE ls.id = t.id AND ls.performed_text = t.reps_text;
--   The `= t.reps_text` guard keeps it from touching a row a coach or athlete
--   has since edited by hand.

WITH combo_line AS (
  -- Every planned set line of every combo, carrying the set-number range it
  -- occupies on the athlete's card: (through - line_sets, through].
  SELECT
    sl.planned_exercise_id,
    sl.reps_text,
    sl.reps,
    greatest(sl.sets, 1) AS line_sets,
    sum(greatest(sl.sets, 1)) OVER (
      PARTITION BY sl.planned_exercise_id
      ORDER BY sl.position
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS through
  FROM planned_set_lines sl
  JOIN planned_exercises pe ON pe.id = sl.planned_exercise_id
  WHERE pe.is_combo
    -- "Hide sets below the top set" makes the card expand ONLY the heaviest
    -- line, so set 1 is not line 1 and the positional mapping in condition 3
    -- would be wrong. No combo uses it today; excluded so that stays true
    -- later. COALESCE, because `metadata->'athleteHidden'` is NULL on most
    -- rows and NOT NULL is NULL — which would silently exclude everything.
    AND NOT COALESCE(
      (pe.metadata -> 'athleteHidden') @> '"belowTopSet"'::jsonb, false)
),
combo_span AS (
  -- How many sets the prescription pre-builds; anything above this the
  -- athlete added themselves.
  SELECT planned_exercise_id, max(through) AS planned_sets
  FROM combo_line
  GROUP BY planned_exercise_id
),
target AS (
  -- DISTINCT because a prescription may repeat a tuple across lines
  -- ("40×2+2, 45×2+2×2"), which joins one set to both. Condition 2
  -- guarantees they agree on the text, so collapsing them is lossless.
  SELECT DISTINCT ls.id, cl.reps_text
  FROM training_log_sets ls
  JOIN training_log_exercises le ON le.id = ls.log_exercise_id
  JOIN combo_span cs ON cs.planned_exercise_id = le.planned_exercise_id
  JOIN combo_line cl
    ON cl.planned_exercise_id = le.planned_exercise_id
   AND cl.reps_text LIKE '%+%'
   AND cl.reps = ls.performed_reps                    -- condition 1
  WHERE ls.performed_text IS NULL
    AND ls.performed_reps IS NOT NULL
    AND NOT EXISTS (                                  -- condition 2
      SELECT 1
      FROM planned_set_lines o
      WHERE o.planned_exercise_id = le.planned_exercise_id
        AND o.reps = ls.performed_reps
        AND o.reps_text IS DISTINCT FROM cl.reps_text
    )
    AND (                                             -- condition 3
      ls.set_number > cs.planned_sets                 --   athlete-added extra
      OR (ls.set_number >  cl.through - cl.line_sets  --   this line's slot
      AND ls.set_number <= cl.through)
    )
)
UPDATE training_log_sets ls
SET performed_text = t.reps_text
FROM target t
WHERE ls.id = t.id;
