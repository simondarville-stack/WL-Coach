-- KinEMOS P3c — the reference lift (docs/KINEMOS_DESIGN.md §8 comparison
-- item 3, docs/KINEMOS_P3_PLAN.md §6).
--
-- Design §8 ranks "versus a model lift" third among comparison needs, and the
-- P3 plan deferred it because no notion of a reference lift existed. This is
-- that notion, at its smallest: a coach marks ONE analysed rep as the lift the
-- athlete's other lifts of that exercise are judged against — their best
-- snatch, the one that "looked right". Comparison opens on it; trends draw it
-- as a line.
--
-- One reference per (athlete, exercise) is the rule, and it is enforced in the
-- application, not here: an analysis carries no athlete or exercise of its own
-- (it names its clip polymorphically; see 20260901180000_kinemos_analysis),
-- so the database cannot state the constraint. `referenceService` clears the
-- previous holder when a new one is set.
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS is_reference boolean NOT NULL DEFAULT false;

-- References are few and read by every comparison picker and trend view.
CREATE INDEX IF NOT EXISTS kinemos_analyses_reference_idx
  ON kinemos_analyses (is_reference) WHERE is_reference;
