-- KinEMOS P3i — the lens tier of the calibration ladder
-- (docs/KINEMOS_DESIGN.md §6.1 and §11 `kinemos_device_profiles`,
-- docs/KINEMOS_P3_PLAN.md §12).
--
-- A profile is one number: k1 of the division model, normalised by half the
-- image diagonal so it describes the LENS rather than the recording, and
-- transfers from a 1080p clip to a 4K one from the same phone. Everything
-- else here is provenance — what it was measured from and how well it fitted
-- — because a correction with no evidence behind it is worse than none.
--
-- Keyed by device, not by athlete. The design sketch hung profiles off the
-- athlete, and an athlete does own a phone; but what is being measured is a
-- lens, several athletes in a club film on the same model, and a coach who
-- measures "Apple iPhone 14 Pro" once has measured it for everyone. So the
-- key is the normalised make+model that `kinemos_videos` already probes from
-- the container metadata, and `athlete_id` is kept only as provenance for the
-- case where the fit came from one athlete's own footage.
--
-- This is what makes design §6.1's "model-lookup tier" real without shipping
-- a table of phones nobody measured: the lookup table is what the coaches
-- themselves measured, and the tier a clip lands on says which.
CREATE TABLE IF NOT EXISTS kinemos_device_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NULL,
  -- Normalised "<make> <model>", lower case, single-spaced. The one clips
  -- are looked up by.
  device_key text NOT NULL,
  device_make text NULL,
  device_model text NULL,
  -- Whose footage it was fitted on. Provenance only; the profile applies to
  -- every clip from the same device.
  athlete_id uuid NULL REFERENCES athletes(id) ON DELETE SET NULL,

  -- The lens. Negative is barrel, the usual for a phone's wide lens.
  k1 double precision NOT NULL,
  -- How it was arrived at: 'plumb-line' is the fit over straight edges in
  -- the clip itself; 'manual' is a coach typing a number they know.
  method text NOT NULL DEFAULT 'plumb-line' CHECK (method IN ('plumb-line', 'manual')),

  -- The evidence, kept so a later reader can judge the number rather than
  -- take it: how straight the edges were before and after, how many there
  -- were, and the frame the fit ran on.
  residual_before_px double precision NULL,
  residual_after_px double precision NULL,
  chains integer NULL,
  frames integer NULL,
  frame_width integer NULL,
  frame_height integer NULL,
  -- The clip it was measured from, for the coach who wants to go and look.
  source_kind text NULL CHECK (source_kind IN ('log', 'event', 'direct')),
  source_id text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One profile per device per environment; re-measuring replaces it
-- (last write wins, as everywhere in EMOS).
CREATE UNIQUE INDEX IF NOT EXISTS kinemos_device_profiles_key_idx
  ON kinemos_device_profiles (owner_id, device_key);
