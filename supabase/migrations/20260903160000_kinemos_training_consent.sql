-- KinEMOS P4a — consent for training-data use
-- (docs/KINEMOS_DESIGN.md §10, docs/KINEMOS_P4_PLAN.md §2).
--
-- Design §10 states the rule and this table is it: "consent for training-data
-- use is per-athlete, recorded, revocable". Three words, three columns.
--
-- Why a table of its own rather than a flag on `athletes`. Consent is not an
-- attribute of a person, it is a decision with a date, and revoking it must
-- not erase the fact that it was once given — a clip exported under consent
-- last March was lawfully exported, and a boolean flipped to false cannot
-- say so. So the row keeps `granted_at` and `revoked_at` separately, and the
-- current state is "granted and not revoked".
--
-- Scope is deliberately narrow. This governs ONE use: whether an athlete's
-- coach-corrected tracks may leave KinEMOS as machine-learning training
-- data. It is not a general processing consent, it grants nothing about the
-- video itself, and nothing in the product reads it except the flywheel
-- export.
CREATE TABLE IF NOT EXISTS kinemos_training_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NULL,
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,

  -- When it was given, and when it was taken back. Both kept: a withdrawal
  -- ends future use, it does not rewrite the past.
  granted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  -- Who recorded it, and anything they wrote down about how it was given.
  recorded_by_coach_id uuid NULL,
  note text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One standing record per athlete per environment.
CREATE UNIQUE INDEX IF NOT EXISTS kinemos_training_consent_athlete_idx
  ON kinemos_training_consent (owner_id, athlete_id);

-- RLS on with the permissive policy, matching every other KinEMOS table.
-- See the note in 20260903120000_kinemos_shares.sql. This table records a
-- consent decision, so it is the first one the auth phase should tighten.
ALTER TABLE kinemos_training_consent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all ON kinemos_training_consent;
CREATE POLICY anon_all ON kinemos_training_consent FOR ALL USING (true) WITH CHECK (true);
