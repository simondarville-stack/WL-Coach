-- Add variation_note to planned_exercises
ALTER TABLE planned_exercises ADD COLUMN IF NOT EXISTS variation_note text DEFAULT NULL;

-- Add metric toggle settings to general_settings
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS visible_summary_metrics text[] DEFAULT '{sets,reps,tonnage,hi,avg}',
  ADD COLUMN IF NOT EXISTS show_stress_metric boolean DEFAULT false;
