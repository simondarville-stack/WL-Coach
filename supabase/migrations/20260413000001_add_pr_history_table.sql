-- athlete_pr_history: time-series personal record entries
-- Each row represents one PR achievement (exercise, rep count, kg, date).
-- Multiple rows per athlete+exercise are allowed, enabling trend analysis
-- and accurate % resolution based on the PR at a given point in time.

create table if not exists athlete_pr_history (
  id            uuid        primary key default gen_random_uuid(),
  athlete_id    uuid        not null references athletes(id) on delete cascade,
  exercise_id   uuid        not null references exercises(id) on delete cascade,
  rep_count     integer     not null check (rep_count between 1 and 10),
  value_kg      numeric(7,2) not null check (value_kg > 0),
  achieved_date date        not null default current_date,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists athlete_pr_history_athlete_exercise
  on athlete_pr_history(athlete_id, exercise_id);

create index if not exists athlete_pr_history_athlete_date
  on athlete_pr_history(athlete_id, achieved_date desc);

-- RLS: owner sees their athletes' data
alter table athlete_pr_history enable row level security;

create policy "owner_access" on athlete_pr_history
  using (
    exists (
      select 1 from athletes a
      where a.id = athlete_pr_history.athlete_id
        and a.owner_id = auth.uid()
    )
  );
