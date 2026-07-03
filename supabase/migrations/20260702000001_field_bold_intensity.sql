-- Field View: coach-configurable intensity threshold (%) at or above which
-- an exercise row renders bold in the /field session tables. NULL falls
-- back to the app default (90).
ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS field_bold_intensity_pct numeric DEFAULT 90;
