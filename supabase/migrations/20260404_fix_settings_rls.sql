-- Fix general_settings RLS: allow anon role to update settings
-- The app has no auth system, so the anon key must be able to write settings.

DROP POLICY IF EXISTS "Authenticated users can update general settings" ON general_settings;
DROP POLICY IF EXISTS "Authenticated users can insert general settings" ON general_settings;

CREATE POLICY "Anyone can update general settings"
  ON general_settings
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can insert general settings"
  ON general_settings
  FOR INSERT
  WITH CHECK (true);
