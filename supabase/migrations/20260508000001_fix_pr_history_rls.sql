-- Fix athlete_pr_history RLS to match the rest of the schema.
--
-- The original policy in 20260413000001_add_pr_history_table.sql used
-- auth.uid() to match athlete owner, but Supabase Auth is a future phase
-- in EMOS — auth.uid() returns NULL for anon clients, so every insert
-- is rejected with:
--   new row violates row-level security policy for table "athlete_pr_history"
--
-- Replace with permissive anon policies, mirroring categories,
-- macrocycles, exercises, etc. Owner-scoped enforcement will be re-added
-- alongside the rest of the schema when auth lands.

drop policy if exists "owner_access" on athlete_pr_history;

create policy "Allow anon to read athlete_pr_history"
  on athlete_pr_history for select to anon using (true);

create policy "Allow anon to insert athlete_pr_history"
  on athlete_pr_history for insert to anon with check (true);

create policy "Allow anon to update athlete_pr_history"
  on athlete_pr_history for update to anon using (true) with check (true);

create policy "Allow anon to delete athlete_pr_history"
  on athlete_pr_history for delete to anon using (true);
