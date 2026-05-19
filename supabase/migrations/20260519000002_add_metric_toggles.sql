-- Coach-toggable per-week metric tracking.
--
-- The coach decides per week which inputs the athlete is asked for:
--   - RAW readiness score (4-pillar Eleiko model, existing columns)
--   - Bodyweight (existing column)
--   - VAS pain score (new column, 0-10)
--   - Custom metrics defined by the coach (number or free text)
--
-- Athlete-side UX: only the toggled-on cells appear in SessionHeader.
-- Coach-side UX: the week-overview metric panel renders only the
-- enabled metrics; weekly tables show what the athlete reported.

-- 1) VAS column on the session row. NULL = not entered for this session.
--    Stored as numeric so coaches can use 1-decimal precision if they
--    want (a coach who treats pain as 0-10 integer can just enter ints).
alter table training_log_sessions
  add column if not exists vas_score numeric null;

comment on column training_log_sessions.vas_score is
  'Athlete-reported Visual Analog Scale pain rating, 0-10. Only collected when athlete_week_metrics_config.track_vas is true.';

-- 2) Custom metric values for the session. Keys are
--    athlete_metric_definitions.id; values are the typed entry the
--    athlete made (number or string).
alter table training_log_sessions
  add column if not exists custom_metrics jsonb not null default '{}'::jsonb;

comment on column training_log_sessions.custom_metrics is
  'Map of athlete_metric_definitions.id => {value_number, value_text}. Only populated when the matching definition is enabled in athlete_week_metrics_config.';

-- 3) Athlete-level custom metric definitions. Each coach + athlete pair
--    can have N persistent metrics; the per-week config picks which to
--    actually collect that week.
create table if not exists athlete_metric_definitions (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  owner_id uuid not null,
  label text not null,
  value_type text not null check (value_type in ('number', 'text')),
  unit text null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists athlete_metric_definitions_athlete_idx
  on athlete_metric_definitions (athlete_id) where archived_at is null;

comment on table athlete_metric_definitions is
  'Persistent custom metric definitions per athlete. Toggled on/off per week via athlete_week_metrics_config.enabled_custom_metric_ids.';

-- 4) Per-week tracking config. Coach toggles which metrics the athlete
--    sees this week. Unique on (athlete, week_start) so a coach can't
--    have two conflicting configs for the same week.
create table if not exists athlete_week_metrics_config (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references athletes(id) on delete cascade,
  owner_id uuid not null,
  week_start date not null,
  track_raw boolean not null default false,
  track_bodyweight boolean not null default false,
  track_vas boolean not null default false,
  enabled_custom_metric_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (athlete_id, week_start)
);

comment on table athlete_week_metrics_config is
  'Per-week toggles for which metric cells appear in the athlete UI and which trend rows appear in the coach week-overview.';

-- 5) Refresh the updated_at on row update for both new tables.
create or replace function set_updated_at_metrics_tables()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_athlete_metric_definitions_updated_at on athlete_metric_definitions;
create trigger trg_athlete_metric_definitions_updated_at
  before update on athlete_metric_definitions
  for each row execute function set_updated_at_metrics_tables();

drop trigger if exists trg_athlete_week_metrics_config_updated_at on athlete_week_metrics_config;
create trigger trg_athlete_week_metrics_config_updated_at
  before update on athlete_week_metrics_config
  for each row execute function set_updated_at_metrics_tables();
