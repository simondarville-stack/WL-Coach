-- KinEMOS P5b — the model-lift library
-- (docs/KINEMOS_DESIGN.md §8 comparison item 3 and §12 P5,
--  docs/KINEMOS_P5_PLAN.md §3).
--
-- P3c gave every athlete a reference lift: their own best snatch, the one
-- that looked right, which comparison opens on and trends draw as a line.
-- That answers "how does this compare to my good one". It does not answer
-- the other question design §8 asks — "how does this compare to a lift that
-- is simply CORRECT" — because a novice's own best rep is not a model of
-- anything.
--
-- A model lift is that second thing: an analysed rep marked as an exemplar
-- for the whole environment, offered when comparing ANY athlete. A world
-- champion's snatch from a competition upload, the coach's own demonstration,
-- a clean technical single by the club's best lifter.
--
-- Two columns, because the difference from a reference lift is entirely in
-- the scope:
--
--   `is_model`     — offer this rep to everyone, not only to its own athlete.
--   `model_label`  — what it is a model OF, in the coach's words. A model
--                    lift without a name is an anonymous bar path; the label
--                    is what makes it teachable ("Textbook second pull",
--                    "Lasha 2021 WR", "Where the bar should meet the hip").
--
-- Deliberately NOT a separate table. A model lift is an ordinary analysis
-- with an ordinary track, calibration, phases and grade — everything that
-- makes it worth comparing against is the analysis itself, and mirroring it
-- would create a second copy to keep in step. Unlike the reference lift there
-- is no one-per-anything rule: a club may keep several models of one lift,
-- and choosing between them is the coach's business.
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS is_model boolean NOT NULL DEFAULT false;
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS model_label text NULL;

-- Models are few and read by every comparison picker.
CREATE INDEX IF NOT EXISTS kinemos_analyses_model_idx
  ON kinemos_analyses (is_model) WHERE is_model;
