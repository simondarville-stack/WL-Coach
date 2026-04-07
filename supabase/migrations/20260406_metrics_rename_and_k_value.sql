-- 1. Rename macro_targets columns: hi → max, ave → avg
ALTER TABLE macro_targets RENAME COLUMN target_hi TO target_max;
ALTER TABLE macro_targets RENAME COLUMN target_ave TO target_avg;
ALTER TABLE macro_targets RENAME COLUMN target_rhi TO target_reps_at_max;
ALTER TABLE macro_targets RENAME COLUMN target_shi TO target_sets_at_max;

-- 2. Add competition_total to athletes (for K-value calculation)
-- This is the best Snatch + best C&J used as the K denominator.
-- NULL = auto-derive from athlete_prs on competition lifts.
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS competition_total numeric(6,2) DEFAULT NULL;

-- 3. Add PR reference to exercises
-- When set, this exercise derives its percentage from another exercise's PR.
-- e.g., Power Snatch references Snatch — so 80% Power Snatch = 80% of Snatch PR.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS pr_reference_exercise_id uuid DEFAULT NULL
  REFERENCES exercises(id) ON DELETE SET NULL;

-- 4. Add track_pr toggle to exercises
-- When false, this exercise is excluded from the PR table entirely.
-- Useful for accessories (sit-ups, carries, etc.) where PRs are irrelevant.
ALTER TABLE exercises
  ADD COLUMN IF NOT EXISTS track_pr boolean DEFAULT true;

-- 5. Link individual plans back to their source group plan
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS source_group_plan_id uuid DEFAULT NULL
  REFERENCES week_plans(id) ON DELETE SET NULL;

-- 6. Track origin of each exercise in an individual plan
-- 'group' = synced from group plan (will be replaced on next sync)
-- 'individual' = added by coach for this specific athlete (preserved on sync)
-- NULL = legacy, treated as 'individual'
ALTER TABLE planned_exercises
  ADD COLUMN IF NOT EXISTS source text DEFAULT NULL
  CHECK (source IN ('group', 'individual'));
