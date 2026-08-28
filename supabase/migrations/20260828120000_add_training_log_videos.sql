-- Athlete-recorded training videos, attached to a logged exercise.
--
-- Shape follows event_videos (side table + URL) rather than stashing a blob of
-- JSON on training_log_exercises.metadata: videos are queried per week and per
-- athlete to drive the coach's review surfaces, and they are deleted
-- independently of the log row that owns them.
--
-- One deliberate departure from event_videos: the storage path is stored in its
-- own column instead of being parsed back out of the public URL at delete time.
-- The URL-parsing approach breaks the moment the bucket is renamed or a CDN
-- prefix appears in front of it.

CREATE TABLE IF NOT EXISTS training_log_videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  log_exercise_id uuid NOT NULL REFERENCES training_log_exercises(id) ON DELETE CASCADE,
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- Which set this shows, when the athlete tagged one. Free-standing clips
  -- (a whole complex, a warm-up cue) leave it null.
  set_number integer,
  video_url text NOT NULL,
  -- Object key inside the bucket, kept so deletes never parse the URL.
  storage_path text,
  description text,
  uploaded_by text NOT NULL DEFAULT 'athlete'
    CHECK (uploaded_by IN ('athlete', 'coach')),
  -- Stamped when a coach opens the clip, so "new footage" can be surfaced
  -- without a second table.
  coach_reviewed_at timestamptz,
  owner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Day/week views fetch by the owning log exercises; the review surfaces fetch
-- an athlete's most recent clips.
CREATE INDEX IF NOT EXISTS idx_tlv_log_exercise ON training_log_videos (log_exercise_id);
CREATE INDEX IF NOT EXISTS idx_tlv_athlete_created ON training_log_videos (athlete_id, created_at DESC);
-- Partial index for the "unreviewed footage" badge.
CREATE INDEX IF NOT EXISTS idx_tlv_unreviewed ON training_log_videos (athlete_id)
  WHERE coach_reviewed_at IS NULL;

ALTER TABLE training_log_videos ENABLE ROW LEVEL SECURITY;

-- Mirrors the other training_log_* tables exactly: permissive anon access for
-- today's no-auth model, plus an ownership-scoped policy that already does the
-- right thing once the auth phase lands and athletes carry auth_user_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_log_videos'
      AND policyname = 'anon_all'
  ) THEN
    CREATE POLICY "anon_all" ON training_log_videos
      FOR ALL TO anon USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_log_videos'
      AND policyname = 'Authenticated users can read all training log videos'
  ) THEN
    CREATE POLICY "Authenticated users can read all training log videos"
      ON training_log_videos FOR SELECT TO authenticated USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'training_log_videos'
      AND policyname = 'Authenticated athletes can manage their training log videos'
  ) THEN
    CREATE POLICY "Authenticated athletes can manage their training log videos"
      ON training_log_videos FOR ALL TO authenticated
      USING (
        athlete_id IN (
          SELECT athletes.id FROM athletes
          WHERE athletes.auth_user_id = (SELECT auth.uid())
        )
      )
      WITH CHECK (
        athlete_id IN (
          SELECT athletes.id FROM athletes
          WHERE athletes.auth_user_id = (SELECT auth.uid())
        )
      );
  END IF;
END $$;

-- Storage bucket. Created here rather than in the dashboard — event-videos was
-- made out-of-band and so has no reproducible definition.
--
-- Capped at 200 MB with an explicit video allow-list: a phone clip of a single
-- lift is a few MB, so anything far past that is a mistake worth rejecting at
-- the edge rather than paying to store.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'log-videos',
  'log-videos',
  true,
  209715200,
  ARRAY['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v', 'video/3gpp']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read access for log-videos'
  ) THEN
    CREATE POLICY "Public read access for log-videos"
      ON storage.objects FOR SELECT USING (bucket_id = 'log-videos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Allow uploads to log-videos'
  ) THEN
    CREATE POLICY "Allow uploads to log-videos"
      ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'log-videos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Allow deletes from log-videos'
  ) THEN
    CREATE POLICY "Allow deletes from log-videos"
      ON storage.objects FOR DELETE USING (bucket_id = 'log-videos');
  END IF;
END $$;
