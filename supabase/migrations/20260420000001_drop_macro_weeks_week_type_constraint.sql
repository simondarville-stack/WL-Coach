-- Drop the hardcoded week_type check constraints from macro_weeks.
-- Week types are now coach-configurable (stored as abbreviations in
-- general_settings.week_types), so any string value must be allowed.

ALTER TABLE macro_weeks DROP CONSTRAINT IF EXISTS macro_weeks_week_type_check;
ALTER TABLE macro_weeks DROP CONSTRAINT IF EXISTS valid_week_type;
