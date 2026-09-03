-- KinEMOS P3h — sharing (docs/KINEMOS_DESIGN.md §9 and §11 `kinemos_shares`,
-- docs/KINEMOS_P3_PLAN.md §11).
--
-- A share is a coach handing an athlete one analysed rep: a picture of the
-- lift with its bar path, the numbers as they stood when it was shared, and
-- a word from the coach. It rides the existing coach↔athlete thread (design
-- §9: "sharing rides existing EMOS channels; no new messaging
-- infrastructure"): the coach's words go into `training_log_messages` as an
-- ordinary general-thread message, and this row is the card the thread
-- surfaces draw beside it, interleaved by time the way session clips are.
--
-- The numbers are FROZEN here (`summary`), not read from the analysis: a
-- coach who re-tracks the rep tomorrow changes the analysis, and the athlete
-- must still see what they were sent. The picture is a snapshot JPEG in R2
-- (`asset_key`), the same object a saved snapshot uses.
--
-- `channel` names the target kind — the athlete app now; a colleague coach
-- and an export are the design's other two, not built. `athlete_id` is set
-- for the athlete channel.
CREATE TABLE IF NOT EXISTS kinemos_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NULL,
  analysis_id uuid NOT NULL REFERENCES kinemos_analyses(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'athlete' CHECK (channel IN ('athlete', 'club', 'export')),
  athlete_id uuid NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- Which coach shared it; labels the card in a shared inbox.
  sender_coach_id uuid NULL,
  -- The colleague it went to, on the club channel. Coaches have no thread
  -- of their own, so the share itself carries the words (`note`) and the
  -- colleague finds it on the KinEMOS library under "Shared with you".
  recipient_coach_id uuid NULL REFERENCES coach_profiles(id) ON DELETE CASCADE,
  note text NULL,
  -- When the colleague first opened it.
  coach_read_at timestamptz NULL,
  -- The message row that carries the coach's words, when one was written.
  message_id uuid NULL REFERENCES training_log_messages(id) ON DELETE SET NULL,
  -- R2 key of the share's picture — the frame with the bar path drawn.
  asset_key text NULL,
  -- What the card says: athlete, exercise, date, load, rep, the headline
  -- numbers and the grade, frozen at share time.
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- When the athlete first opened it. One-way, like message read state:
  -- shown to the coach, never to the athlete.
  athlete_read_at timestamptz NULL
);

-- The athlete app reads its own shares by athlete; the viewer lists a rep's.
CREATE INDEX IF NOT EXISTS kinemos_shares_athlete_idx ON kinemos_shares (athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kinemos_shares_analysis_idx ON kinemos_shares (analysis_id);
CREATE INDEX IF NOT EXISTS kinemos_shares_recipient_idx ON kinemos_shares (recipient_coach_id, created_at DESC);
