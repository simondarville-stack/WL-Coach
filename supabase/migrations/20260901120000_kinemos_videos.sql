-- KinEMOS direct-import video registry (docs/KINEMOS_DESIGN.md §11).
--
-- The KinEMOS library is a UNION of three sources — training_log_videos,
-- event_videos, and this table — read through one service. Nothing is
-- mirrored: log clips and competition clips keep living where they already
-- live, so there is no copy to keep in sync and no migration of existing rows.
-- This table holds ONLY videos imported directly into KinEMOS: long-form
-- footage (a whole competition session, a full training set, a seminar clip)
-- that the 200 MB Supabase video buckets refuse and that has no log entry
-- behind it.
--
-- Bytes live in R2 under `r2_key`, served by worker/index.ts with Range
-- support; see wrangler.toml's KINEMOS_VIDEOS binding. Only the key is stored,
-- never a URL: the serving origin is a deployment detail, and one of the ways
-- the Netlify-era links rotted was baking the origin into stored rows.
CREATE TABLE IF NOT EXISTS kinemos_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Follows the owner_id pattern so the future auth/RLS phase needs no schema
  -- surgery (CLAUDE.md "Auth & access").
  owner_id uuid,

  -- BOTH nullable, deliberately: unattached videos are first-class in KinEMOS
  -- (a seminar clip, another club's lifter, footage the coach has not yet
  -- decided about). ON DELETE SET NULL because removing an athlete must not
  -- silently destroy footage that may still be worth studying.
  athlete_id uuid REFERENCES athletes(id) ON DELETE SET NULL,
  exercise_id uuid REFERENCES exercises(id) ON DELETE SET NULL,

  -- R2 object keys: '<uuid>.<ext>' for the clip, '<uuid>.jpg' for the poster
  -- frame. Validated worker-side against the same shape.
  r2_key text NOT NULL UNIQUE,
  thumb_key text,

  original_name text,
  size_bytes bigint,

  -- Probed client-side at import. fps/width/height are what the analysis
  -- phases need to reason about accuracy (a 30 fps clip cannot resolve a
  -- turnover the way a 60 fps one can), so they are captured now even though
  -- P0 only displays them.
  duration_s numeric,
  fps numeric,
  width integer,
  height integer,

  -- Read from container metadata where the phone left it. Seeds the
  -- model-lookup calibration tier (design §6.1); frequently absent, never
  -- required.
  device_make text,
  device_model text,

  -- Trim provenance: what the coach kept, and out of how much.
  trimmed boolean NOT NULL DEFAULT false,
  original_duration_s numeric,

  -- When the lift happened, as opposed to when it was imported. Nullable
  -- because a file handed over months later often cannot say.
  recorded_at timestamptz,
  note text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The library's default view is newest-first, optionally narrowed to one
-- athlete or one exercise.
CREATE INDEX IF NOT EXISTS kinemos_videos_created_idx
  ON kinemos_videos (created_at DESC);
CREATE INDEX IF NOT EXISTS kinemos_videos_athlete_idx
  ON kinemos_videos (athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS kinemos_videos_exercise_idx
  ON kinemos_videos (exercise_id, created_at DESC);

-- Interim access model, identical to training_log_videos: RLS is ON with a
-- permissive anon policy, so the table is not left exposed-and-unguarded for
-- the advisor to flag, while the real policy waits for the auth phase to
-- define it (CLAUDE.md: do not add auth gating on our own initiative).
ALTER TABLE kinemos_videos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all ON kinemos_videos;
CREATE POLICY anon_all ON kinemos_videos FOR ALL USING (true) WITH CHECK (true);
