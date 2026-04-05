-- Patch: allow anon role to read/write coach_profiles
-- The original policy only covered 'authenticated' but this app uses no auth.
CREATE POLICY "Allow anon access" ON coach_profiles
  FOR ALL TO anon USING (true) WITH CHECK (true);
