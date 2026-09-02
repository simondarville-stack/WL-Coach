-- KinEMOS P2 — phase boundaries, computed metrics and the quality grade
-- (docs/KINEMOS_DESIGN.md §7 and §11, docs/KINEMOS_P2_PLAN.md W5).
--
-- P1 stored what the coach MARKED. These columns store what the engine made of
-- it, plus the coach's corrections to that.

-- Phase boundaries as the coach has them: [{ "phaseId", "t", "rule", "source" }].
--
-- `source` is the honest part — 'detected' when the engine found the signature
-- it was looking for, 'fallback' when it did not and placed the edge
-- proportionally, 'coach' once a person has dragged it. A fallback edge is a
-- guess and the interface says so; a coach edge is the answer and nothing
-- overwrites it (design §7: automation proposes, the coach disposes).
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS phase_boundaries jsonb;

-- Which phase model produced them. Coaches disagree about how a lift divides,
-- so the set is data (see engine/phases.ts) and an analysis records which one
-- it was segmented under — otherwise a later reader cannot tell whether a
-- "second pull" means the same thing across two analyses.
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS phase_set_id text NOT NULL DEFAULT 'default';

-- Computed metrics, per phase and overall. A CACHE, not a source of truth: the
-- track and the calibration are, and this is recomputed on every load. It is
-- stored so trend views and exports can read a season of analyses without
-- re-running the pipeline on each one.
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS metrics jsonb;

-- The grade and the number behind it. Stored together deliberately: a letter
-- without its error estimate is the decoration this product is trying not to
-- be (design §6.4).
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS grade text
  CHECK (grade IS NULL OR grade IN ('A', 'B', 'C'));
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS grade_error_ms numeric;
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS grade_factors jsonb;

-- How the clip was filmed. Not derivable from the pixels in P1/P2 — the
-- stabiliser that would infer it is a later phase — so it is the coach's to
-- state, and it is worth ~50 % of the error budget between tripod and handheld.
ALTER TABLE kinemos_analyses ADD COLUMN IF NOT EXISTS camera text
  CHECK (camera IS NULL OR camera IN ('tripod', 'stabilised', 'handheld', 'unknown'));
