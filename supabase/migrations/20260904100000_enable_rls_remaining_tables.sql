-- Enable RLS on the four public tables that were still without it.
--
-- `macro_templates`, `coach_presets`, `review_feed_seen` and
-- `coach_thread_reads` were created without `ENABLE ROW LEVEL SECURITY`,
-- while every other table in the schema has it. Supabase's security advisor
-- flags each as an ERROR: a table in a PostgREST-exposed schema with RLS off
-- is readable and writable by anyone holding the anon key.
--
-- **This changes no behaviour today.** The policy is `USING (true) WITH CHECK
-- (true)` — the same permissive `anon_all` every other table in EMOS carries
-- — because auth and real RLS are a later phase (CLAUDE.md, "Auth &
-- access") and this migration is not that phase. Access before and after is
-- identical.
--
-- What it changes is where the tables will be when that phase arrives. A
-- table with RLS on and a permissive policy is tightened by editing one
-- policy. A table with RLS off is a table nobody remembered was ungoverned,
-- and it is found by an advisor rather than by a plan.
--
-- **The two statements must go together.** These four tables have no
-- policies at all (verified against `pg_policies` before writing this), so
-- enabling RLS on its own would deny every read and write and take four
-- working features down. The policy is what keeps the switch a no-op.
--
-- Data at the time of writing: macro_templates 2 rows, coach_presets 3,
-- review_feed_seen 161, coach_thread_reads 24. Nothing here reads or writes
-- a row.

ALTER TABLE public.macro_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON public.macro_templates;
CREATE POLICY anon_all ON public.macro_templates FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.coach_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON public.coach_presets;
CREATE POLICY anon_all ON public.coach_presets FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.review_feed_seen ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON public.review_feed_seen;
CREATE POLICY anon_all ON public.review_feed_seen FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.coach_thread_reads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON public.coach_thread_reads;
CREATE POLICY anon_all ON public.coach_thread_reads FOR ALL USING (true) WITH CHECK (true);
