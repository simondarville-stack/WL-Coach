-- Coach-to-coach sharing of athletes and groups.
--
-- Adds two join tables (athlete_collaborators, training_group_collaborators)
-- that let a coach grant other coaches access to one of their athletes or
-- groups. The hosting coach (athletes.owner_id / training_groups.owner_id)
-- stays as the primary owner; the join table is purely additive.
--
-- Programmes (week_plans / planned_exercises) and exercise libraries are
-- not duplicated. Co-coaches edit the host's rows directly (Google-Docs
-- model, last-write-wins by updated_at). The exercise picker in the
-- planner queries the host's library when working on a shared athlete.
--
-- Also adds:
--   - week_plans.last_edited_by_coach_id, so the planner can display
--     "Updated by Coach X" when multiple coaches edit one programme.
--   - training_log_messages.sender_coach_id, so a shared inbox can show
--     which coach posted each reply (sender_type already distinguishes
--     athlete vs coach; sender_coach_id disambiguates among coaches).
--
-- Anon transitional RLS matches the rest of the schema until Auth cutover.
--
-- Rollback:
--   DROP TABLE IF EXISTS training_group_collaborators;
--   DROP TABLE IF EXISTS athlete_collaborators;
--   ALTER TABLE week_plans             DROP COLUMN IF EXISTS last_edited_by_coach_id;
--   ALTER TABLE training_log_messages  DROP COLUMN IF EXISTS sender_coach_id;

-- ─── athlete_collaborators ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS athlete_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  coach_id   uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,

  -- Two roles to start. co_coach has full programme + training-data write
  -- access; viewer is read-only. Resist adding more roles until concrete
  -- needs surface — split later if necessary.
  role text NOT NULL CHECK (role IN ('co_coach', 'viewer')),

  -- The coach who initiated the invite. Usually the host (athletes.owner_id)
  -- but could be another co_coach in a future "delegated invites" model.
  invited_by uuid NOT NULL REFERENCES coach_profiles(id),
  invited_at  timestamptz NOT NULL DEFAULT now(),

  -- null while the invite is pending; set when the invitee accepts.
  accepted_at timestamptz,
  -- set when the host (or the collaborator themselves) revokes access.
  revoked_at  timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- One row per (athlete, coach) pair. Re-invites mutate the existing row
  -- (clear revoked_at, refresh invited_at) rather than creating duplicates.
  UNIQUE (athlete_id, coach_id)
);

-- "What's shared with me right now?" — the predicate the athletes-list
-- query uses on every coach login. Partial index keeps it tight: only
-- accepted-and-not-revoked rows are indexed.
CREATE INDEX IF NOT EXISTS athlete_collaborators_active_for_coach_idx
  ON athlete_collaborators (coach_id, athlete_id)
  WHERE accepted_at IS NOT NULL AND revoked_at IS NULL;

-- "Who can access this athlete?" — used in the share-management UI.
CREATE INDEX IF NOT EXISTS athlete_collaborators_athlete_idx
  ON athlete_collaborators (athlete_id);

ALTER TABLE athlete_collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all ON athlete_collaborators
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ─── training_group_collaborators ───────────────────────────────────────────
-- Same shape, scoped to a group. Sharing a group grants access to the
-- group programme only — individual member athletes must be shared
-- separately (no cascade, per design decision).

CREATE TABLE IF NOT EXISTS training_group_collaborators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES training_groups(id) ON DELETE CASCADE,
  coach_id uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,

  role text NOT NULL CHECK (role IN ('co_coach', 'viewer')),

  invited_by uuid NOT NULL REFERENCES coach_profiles(id),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  revoked_at  timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (group_id, coach_id)
);

CREATE INDEX IF NOT EXISTS training_group_collaborators_active_for_coach_idx
  ON training_group_collaborators (coach_id, group_id)
  WHERE accepted_at IS NOT NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS training_group_collaborators_group_idx
  ON training_group_collaborators (group_id);

ALTER TABLE training_group_collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all ON training_group_collaborators
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- ─── Tracking columns ───────────────────────────────────────────────────────

-- Which coach last touched a shared week_plan. Null on rows created before
-- this column existed and on plans only ever edited by their owner.
-- The planner UI uses this to show "Updated 2 min ago by Coach Møller"
-- when last_edited_by_coach_id ≠ week_plans.owner_id.
ALTER TABLE week_plans
  ADD COLUMN IF NOT EXISTS last_edited_by_coach_id uuid REFERENCES coach_profiles(id);

-- Disambiguate among multiple coaches who can post into a shared athlete
-- thread. sender_type already separates athlete from coach; this column
-- identifies which coach for messages where sender_type = 'coach'.
ALTER TABLE training_log_messages
  ADD COLUMN IF NOT EXISTS sender_coach_id uuid REFERENCES coach_profiles(id);
