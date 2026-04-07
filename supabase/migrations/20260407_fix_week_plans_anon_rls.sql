-- Fix week_plans RLS: restore anon (anonymous) write access.
-- The 20260312083205 group plan migration accidentally replaced the original
-- "Anyone can X" policies with "authenticated"-only policies. Since this app
-- uses the anon Supabase role throughout, creating new week plans (including
-- group plans) was silently blocked.

DROP POLICY IF EXISTS "Authenticated users can create week plans" ON week_plans;
DROP POLICY IF EXISTS "Authenticated users can update week plans" ON week_plans;
DROP POLICY IF EXISTS "Authenticated users can delete week plans" ON week_plans;
DROP POLICY IF EXISTS "Anyone can view week plans" ON week_plans;

-- Restore open policies matching the rest of the app's security model
CREATE POLICY "Anyone can view week plans"
  ON week_plans FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anyone can insert week plans"
  ON week_plans FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Anyone can update week plans"
  ON week_plans FOR UPDATE
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Anyone can delete week plans"
  ON week_plans FOR DELETE
  TO anon
  USING (true);
