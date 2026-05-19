-- RLS for the metric-toggle tables introduced in
-- 20260519000002_add_metric_toggles.sql. Supabase enables RLS by
-- default on new tables, and Auth is a future phase in EMOS, so
-- every write was being rejected with code 42501 ("new row violates
-- row-level security policy"). We mirror the permissive anon policies
-- already used on categories, macrocycles, exercises, athlete_pr_history,
-- etc. Owner-scoped enforcement will be re-added alongside the rest
-- of the schema when auth lands.

-- athlete_metric_definitions
create policy "Allow anon to read athlete_metric_definitions"
  on athlete_metric_definitions for select to anon using (true);

create policy "Allow anon to insert athlete_metric_definitions"
  on athlete_metric_definitions for insert to anon with check (true);

create policy "Allow anon to update athlete_metric_definitions"
  on athlete_metric_definitions for update to anon using (true) with check (true);

create policy "Allow anon to delete athlete_metric_definitions"
  on athlete_metric_definitions for delete to anon using (true);

-- athlete_week_metrics_config
create policy "Allow anon to read athlete_week_metrics_config"
  on athlete_week_metrics_config for select to anon using (true);

create policy "Allow anon to insert athlete_week_metrics_config"
  on athlete_week_metrics_config for insert to anon with check (true);

create policy "Allow anon to update athlete_week_metrics_config"
  on athlete_week_metrics_config for update to anon using (true) with check (true);

create policy "Allow anon to delete athlete_week_metrics_config"
  on athlete_week_metrics_config for delete to anon using (true);
