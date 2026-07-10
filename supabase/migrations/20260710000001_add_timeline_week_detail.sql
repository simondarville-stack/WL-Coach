-- Macro review table (planner header): which target metrics expand on the
-- active week's column ('reps' = K rep target, 'max' = max target,
-- 'avg' = average target). NULL falls back to all three.
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS timeline_week_detail TEXT[] DEFAULT ARRAY['reps','max','avg']::TEXT[];
