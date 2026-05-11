-- Apply with: supabase db push (user must apply)
-- Adds configurable OWL analysis threshold fields to general_settings.
-- NULL values fall back to application defaults.

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS lift_ratio_targets       jsonb    NULL,
  ADD COLUMN IF NOT EXISTS intensity_zones          jsonb    NULL,
  ADD COLUMN IF NOT EXISTS compliance_warning_threshold integer NULL,
  ADD COLUMN IF NOT EXISTS low_intensity_zone_max_pct   integer NULL;

COMMENT ON COLUMN general_settings.lift_ratio_targets IS
  'Configurable target ranges for OWL lift ratios, e.g. {"Sn/CJ": {"min": 60, "max": 70}}. NULL → application defaults.';
COMMENT ON COLUMN general_settings.intensity_zones IS
  'Custom intensity zone boundaries. NULL → application defaults ([<70%, 70-80%, 80-90%, 90%+]).';
COMMENT ON COLUMN general_settings.compliance_warning_threshold IS
  'Compliance % below which a streak warning fires. NULL → 85.';
COMMENT ON COLUMN general_settings.low_intensity_zone_max_pct IS
  'Max % of reps below 70% 1RM before flagging low intensity. NULL → 50.';
