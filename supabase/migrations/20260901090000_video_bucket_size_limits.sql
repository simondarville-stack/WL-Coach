-- Declare file_size_limit and allowed_mime_types for every video bucket, and
-- bring log-videos' declaration back in line with what is actually deployed.
--
-- ## Why
--
-- `event-videos` and `planner-media` were created without a file_size_limit,
-- so their real ceiling was the project's global upload limit — a Supabase
-- dashboard setting no migration can see and therefore no client can mirror.
-- The app uploaded happily, storage refused, and the athlete read "The object
-- exceeded the maximum allowed size" with no idea what to do about it. With
-- the limit declared here, `videoLimits.ts` states it up front and the clip
-- editor opens on an oversized clip instead of after the upload is spent.
--
-- ## Two repairs to log-videos, which had drifted from its own migration
--
-- 1. allowed_mime_types was missing 'image/jpeg'. `uploadLogVideo` writes a
--    poster next to every clip at `<path>.jpg` with that content type, so the
--    deployed bucket had it added out-of-band — meaning a replay of
--    20260828120000 would have silently broken every new clip's thumbnail.
--    It is included here so the repository is the source of truth again.
-- 2. The deployed limit was 400 MB against a declared 200 MB. 200 MB wins:
--    it is what the client enforces, and now that clips are trimmed to the
--    lift before upload it is generous for footage of a single attempt.
--
-- ## Not destructive
--
-- No object is removed and no existing object becomes unreadable. Both
-- settings are enforced on upload only, so anything already stored larger
-- than 200 MB keeps serving.
--
-- The project's *global* upload limit still sits underneath all of this and
-- can be lower than any value here; `isStorageSizeRejection` in videoLimits.ts
-- stays the backstop for that case.

-- log-videos: athlete training clips, plus the poster JPEG captured per clip.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'log-videos',
  'log-videos',
  true,
  209715200,
  ARRAY[
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v', 'video/3gpp',
    'image/jpeg'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- event-videos: competition attempt footage. Created out-of-band originally,
-- so this is also the first time it has a definition in the repository.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'event-videos',
  'event-videos',
  true,
  209715200,
  ARRAY['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v', 'video/3gpp']
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- planner-media: a coach's demo video OR a reference image for an exercise, so
-- the allow-list has to cover both — a video-only list here would break the
-- image sentinel, which shares this bucket and this picker.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'planner-media',
  'planner-media',
  true,
  209715200,
  ARRAY[
    'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-m4v', 'video/3gpp',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
