-- Review feed coach settings: customizable quick reactions + technique-rating toggle.
--
-- review_quick_reactions: the coach's own quick-reaction chips on Review cards.
--   NULL = use the app defaults (src/lib/reviewSettings.ts), matching the
--   phase_type_presets / rhythm_presets convention. An empty array is a valid
--   choice meaning "no reaction chips".
-- review_technique_rating_enabled: shows the 1-5 technique rating control on
--   Review cards (writes training_log_exercises.technique_rating).

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS review_quick_reactions text[],
  ADD COLUMN IF NOT EXISTS review_technique_rating_enabled boolean NOT NULL DEFAULT true;
