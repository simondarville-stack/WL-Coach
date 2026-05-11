-- Add coach-configurable defaults for the percentage → kg conversion
-- rounding controls in general_settings.
--
-- The conversion modal in the weekly planner has a "Round results"
-- toggle + "to nearest X kg" input. Until now these were hardcoded to
-- (enabled, 0.5). Move the initial state to coach settings so each
-- environment can default to whatever increment the coach typically uses.

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS percent_to_kg_round_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS percent_to_kg_round_increment numeric(6,2) NOT NULL DEFAULT 0.5;
