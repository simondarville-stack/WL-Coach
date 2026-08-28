-- Club layer: a first-class organisation entity above coaches.
--
-- SHARED_EXERCISE_CATALOGUE_PLAN.md §4 deliberately deferred a clubs table
-- and reserved the adoption seam ("a future clubs table adopts the catalogue
-- by adding exercise_libraries.club_id"). This migration is that step:
--
--   clubs               — the organisation (name only for now; it will grow
--                         toward owning athletes/groups/competitions later).
--   club_members        — coach membership with roles 'admin' | 'coach',
--                         invite/accept/revoke lifecycle (same idiom as
--                         athlete_collaborators / exercise_library_members).
--   exercise_libraries.club_id — a club catalogue is ATTACHED to its club;
--                         null keeps a catalogue standalone (the 0.52.0
--                         ad-hoc sharing flow keeps working unchanged).
--
-- Membership stays explicit (never derived from the free-text
-- coach_profiles.club_name, which is already inconsistent in live data).
--
-- clubs has no owner_id: it is inherently cross-coach. created_by records
-- provenance; the future auth/RLS policy for clubs is membership-based
-- ("club_id IN (my accepted clubs)"), the same shape as the catalogue and
-- athlete-sharing policies.
--
-- Catalogue access provisioning (which club member gets which role on which
-- club catalogue) is app-layer: joining a club grants viewer (coach) /
-- editor (admin) memberships on its catalogues, and the /club admin page
-- exposes the full member × catalogue role matrix. The DB only stores the
-- resulting exercise_library_members rows.
--
-- Rollback:
--   ALTER TABLE exercise_libraries DROP COLUMN IF EXISTS club_id;
--   DROP TABLE IF EXISTS club_members;
--   DROP TABLE IF EXISTS clubs;

CREATE TABLE IF NOT EXISTS clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  notes       text,
  created_by  uuid REFERENCES coach_profiles(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all ON clubs
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS club_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  coach_id    uuid NOT NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,

  -- admin runs the club (members, catalogues, roles); coach is a member.
  role        text NOT NULL CHECK (role IN ('admin', 'coach')),

  invited_by  uuid NOT NULL REFERENCES coach_profiles(id),
  invited_at  timestamptz NOT NULL DEFAULT now(),
  -- null while the invite is pending; set when the invitee accepts.
  accepted_at timestamptz,
  -- set when an admin removes the member, or the member leaves/declines.
  revoked_at  timestamptz,

  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- One row per (club, coach); re-invites mutate the existing row.
  UNIQUE (club_id, coach_id)
);

-- "Which clubs am I in?" — the membership predicate.
CREATE INDEX IF NOT EXISTS club_members_active_for_coach_idx
  ON club_members (coach_id, club_id)
  WHERE accepted_at IS NOT NULL AND revoked_at IS NULL;

-- "Who is in this club?" — the admin page.
CREATE INDEX IF NOT EXISTS club_members_club_idx
  ON club_members (club_id);

ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all ON club_members
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

-- The adoption seam reserved by the catalogue plan: a club catalogue belongs
-- to its club. ON DELETE SET NULL — deleting a club detaches its catalogues
-- back to standalone rather than destroying shared exercise data.
ALTER TABLE exercise_libraries
  ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES clubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS exercise_libraries_club_idx
  ON exercise_libraries (club_id);
