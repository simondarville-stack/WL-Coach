-- Poster thumbnails for training-log clips.
--
-- Every clip tile used to be a <video preload="metadata"> — phone MP4s keep
-- their index (moov atom) at the end of the file, so painting one poster
-- frame pulls large byte ranges, and a strip of clips fires that N times.
-- The client now captures a small JPEG at upload time and stores its public
-- URL here; tiles render the image instead. NULL (older rows) falls back to
-- the lazy <video> poster.
ALTER TABLE training_log_videos
  ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- The bucket's MIME allow-list must admit the JPEG posters. Everything else
-- (size cap, video types) stays exactly as 20260828120000 set it.
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'video/x-m4v', 'video/3gpp', 'image/jpeg'
]
WHERE id = 'log-videos';
