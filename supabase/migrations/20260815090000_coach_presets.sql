-- # Prescription presets — coach-configurable templates applied from the
-- planner's add-exercise search (#Name) or a row's + menu. A preset carries
-- an optional prescription template in the canonical grammar (signs, ranges,
-- comma segments all included), optional exercise features (jsonb, same shape
-- as planned_exercises.metadata.features), and an optional row badge.
-- Follows the owner_id pattern (see CLAUDE.md Auth & access).
create table if not exists coach_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  color text not null default '#185FA5',
  show_badge boolean not null default true,
  prescription_raw text,
  unit text,
  features jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_presets_owner_idx on coach_presets(owner_id);
