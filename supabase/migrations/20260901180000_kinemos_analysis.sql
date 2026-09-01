-- KinEMOS P1 analysis records (docs/KINEMOS_DESIGN.md §11,
-- docs/KINEMOS_P1_PLAN.md W8).
--
-- P0 gave the library a place to list every lift video. These four tables give
-- a coach a place to put what they FOUND in one — the plate calibration, the
-- marked bar path, the snapshots and notes. P1 fills them by hand; P2's
-- tracker writes into exactly the same shapes, which is the point: a
-- hand-marked track and a tracked one are the same record with a different
-- `tracker_tier`, so nothing downstream has to care which produced it.
--
-- Source is POLYMORPHIC. A clip worth analysing may be a training-log video, a
-- competition attempt, or a direct KinEMOS import, and the library already
-- reads all three without mirroring them (see 20260901120000_kinemos_videos).
-- An analysis therefore names its source by (source_kind, source_id) rather
-- than by a foreign key to one table. The cost is no referential integrity
-- across the union; the alternative was three near-identical analysis tables
-- or a mirror table to keep in sync forever.

-- ── The analysis: one per rep, not one per clip ──────────────────────────────
--
-- A single recording routinely holds six attempts. Set-level aggregates hide
-- what the coach is looking at (design §7 "per-rep everything"), so the rep is
-- the record and anything set-wide is derived by reading several.
CREATE TABLE IF NOT EXISTS kinemos_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,

  source_kind text NOT NULL CHECK (source_kind IN ('log', 'event', 'direct')),
  source_id uuid NOT NULL,

  -- 1-based, as the coach counts reps.
  rep_index integer NOT NULL DEFAULT 1,
  label text,

  -- The frame geometry the points were captured in. Coordinates are stored in
  -- DISPLAY space (rotation already applied by the frame server), so a reader
  -- that later re-renders the clip at another size — or a browser that applies
  -- rotation differently — can tell whether the stored pixels still mean what
  -- they meant. Without this a track silently becomes wrong rather than
  -- visibly stale.
  frame_width integer,
  frame_height integer,
  rotation integer,

  -- Power needs a mass; P1 does not compute power but the mass is free to
  -- capture here and expensive to reconstruct later. 'logged' when it came
  -- from the training log, 'manual' when the coach typed it (design §7).
  mass_kg numeric,
  mass_source text CHECK (mass_source IS NULL OR mass_source IN ('logged', 'manual')),

  status text NOT NULL DEFAULT 'draft',
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Reopening a clip must find the same analysis, not make a second one.
  UNIQUE (source_kind, source_id, rep_index)
);

CREATE INDEX IF NOT EXISTS kinemos_analyses_source_idx
  ON kinemos_analyses (source_kind, source_id);
CREATE INDEX IF NOT EXISTS kinemos_analyses_updated_idx
  ON kinemos_analyses (updated_at DESC);

-- ── Calibration: the px→cm record, and its provenance ────────────────────────
--
-- Stored as BOTH the coach's ellipse and the scales derived from it. The
-- ellipse so the panel can reopen exactly where it was left; the derived
-- numbers so any reader — a trend view, an export, a future server job — can
-- convert pixels without importing the engine and without silently
-- recalculating with a different plate default.
--
-- Note there are two scales. The plate is a circle: its major axis gives the
-- scale along the bar's travel and its minor axis is that same diameter
-- squashed by cos θ. Collapsing them into one number under-reports every
-- horizontal excursion by 13 % at 30° (design §6.1).
CREATE TABLE IF NOT EXISTS kinemos_calibrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  analysis_id uuid NOT NULL REFERENCES kinemos_analyses(id) ON DELETE CASCADE,

  -- Which frame the plate was outlined on, by index and by real timestamp.
  frame_index integer,
  frame_t numeric,

  ellipse_cx numeric NOT NULL,
  ellipse_cy numeric NOT NULL,
  semi_major_px numeric NOT NULL,
  semi_minor_px numeric NOT NULL,
  tilt_deg numeric NOT NULL DEFAULT 0,
  plate_diameter_cm numeric NOT NULL DEFAULT 45,

  cm_per_px_v numeric,
  cm_per_px_h numeric,
  viewing_angle_deg numeric,
  confidence text,

  -- Calibration ladder tiers that applied (design §6.1). P1 ships the plate
  -- tier only; the columns exist so P3's device profiles and the stabiliser
  -- do not need a migration to record that they ran.
  distortion_source text NOT NULL DEFAULT 'none'
    CHECK (distortion_source IN ('none', 'model', 'profile')),
  stabilised boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- One calibration per analysis in P1. A clip filmed with a moving camera
  -- would want several; that is a P2+ conversation, and lifting this
  -- constraint later is cheaper than deduplicating rows created without it.
  UNIQUE (analysis_id)
);

-- ── Track: the point series ─────────────────────────────────────────────────
--
-- JSONB rather than a row per point: a 6 s lift at 60 fps is ~360 points, read
-- and written as one unit every time, and nothing ever queries a single frame
-- across analyses (design §4 "everything derived → Postgres").
--
-- Shape: [{ "t": 1.234, "x": 512.5, "y": 300.25, "s": "m" }, …]
--   t — the frame's real presentation timestamp in seconds. NOT an index over
--       a nominal fps: phone video is frequently variable rate, and velocity
--       is dx/dt (design §6.3).
--   x, y — display-space pixels, y downward, in the frame geometry recorded on
--       the analysis.
--   s — who put it there: 'm' manual, 't' tracked. P2's corrections make this
--       a mixed series by design, and the quality grade counts the manual
--       ones.
CREATE TABLE IF NOT EXISTS kinemos_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  analysis_id uuid NOT NULL REFERENCES kinemos_analyses(id) ON DELETE CASCADE,

  -- One bar end in v1 (design §3 non-goals: not both ends, not bar rotation).
  -- Named anyway so a marker point or a second end is an added row, not a
  -- schema change.
  kind text NOT NULL DEFAULT 'bar_end',

  points jsonb NOT NULL DEFAULT '[]'::jsonb,

  tracker_tier text NOT NULL DEFAULT 'manual'
    CHECK (tracker_tier IN ('manual', 'assisted', 'marker', 'ml')),
  correction_count integer NOT NULL DEFAULT 0,
  -- Filter type and cutoff are coach-configurable (design §6.3) and belong to
  -- the track that was filtered, not to a global setting.
  filter_settings jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (analysis_id, kind)
);

-- ── Annotations: snapshots, notes, hand measurements ─────────────────────────
--
-- One table for the three because they are the same object to the coach — a
-- thing said about a moment in the lift — and because sharing (P3) will want
-- to enumerate them together. Talkovers land here too when P3 records them.
CREATE TABLE IF NOT EXISTS kinemos_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid,
  analysis_id uuid NOT NULL REFERENCES kinemos_analyses(id) ON DELETE CASCADE,

  kind text NOT NULL CHECK (kind IN ('snapshot', 'note', 'measurement', 'talkover')),

  frame_index integer,
  frame_t numeric,

  body text,
  -- R2 object key for snapshot JPEGs and (later) talkover media. Only the key,
  -- never a URL — same rule as kinemos_videos.r2_key.
  asset_key text,
  -- Measurement geometry ({type, points, valueCm, valueDeg}), drawing data,
  -- whatever a kind needs that does not deserve a column.
  payload jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS kinemos_annotations_analysis_idx
  ON kinemos_annotations (analysis_id, created_at DESC);

-- Interim access model, identical to kinemos_videos: RLS on with a permissive
-- anon policy, so nothing is left exposed-and-unguarded for the advisor to
-- flag while the real policy waits for the auth phase to define it
-- (CLAUDE.md "Auth & access" — do not add auth gating on our own initiative).
ALTER TABLE kinemos_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE kinemos_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kinemos_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE kinemos_annotations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS anon_all ON kinemos_analyses;
CREATE POLICY anon_all ON kinemos_analyses FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all ON kinemos_calibrations;
CREATE POLICY anon_all ON kinemos_calibrations FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all ON kinemos_tracks;
CREATE POLICY anon_all ON kinemos_tracks FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS anon_all ON kinemos_annotations;
CREATE POLICY anon_all ON kinemos_annotations FOR ALL USING (true) WITH CHECK (true);
