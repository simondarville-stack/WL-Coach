-- Macro timeline: coach-configurable metric that drives the load silhouette
-- and the logged-actual marker ('reps' = K total reps, 'tonnage' = kg volume).
-- NULL falls back to the app default ('reps').
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS timeline_metric text DEFAULT 'reps';
