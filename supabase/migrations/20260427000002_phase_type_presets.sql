-- Add phase_type_presets column to general_settings.
-- Stores coach-defined phase type presets as a JSONB array of
-- { value: string, label: string, color: string } objects.
-- NULL means "use application defaults".

ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS phase_type_presets jsonb NULL;

COMMENT ON COLUMN general_settings.phase_type_presets IS
  'Coach-defined phase type presets: [{value, label, color}]. NULL = use app defaults.';
