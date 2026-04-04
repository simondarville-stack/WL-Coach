ALTER TABLE general_settings
  ADD COLUMN IF NOT EXISTS dialog_mode text DEFAULT 'center'
  CHECK (dialog_mode IN ('center', 'sidebar'));
