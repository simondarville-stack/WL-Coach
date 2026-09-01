-- Let an athlete say what is actually in a clip.
--
-- `set_number` already links a clip to a set of its log exercise, but nothing
-- ever wrote it: the athlete could attach footage and had no way to say which
-- lift it was, so a coach opening a strip of five clips had to guess from the
-- thumbnails which one was the 105 kg single.
--
-- These two columns cover the case the set link cannot: a clip of something
-- that is not a logged set — a warm-up single, an extra attempt, a lift filmed
-- before the set rows existed. When `set_number` IS set, the set row remains
-- the source of truth for load and reps and these stay null; the client
-- resolves in that order (see src/lib/clipTag.ts). Storing both would be two
-- places to change one number.
--
-- Naming mirrors training_log_sets.performed_load / performed_reps so the two
-- read the same at every call site.
--
-- Not destructive: two nullable columns, every existing row keeps its meaning
-- (an untagged clip is exactly what it was before).

ALTER TABLE training_log_videos
  ADD COLUMN IF NOT EXISTS performed_load numeric,
  ADD COLUMN IF NOT EXISTS performed_reps integer;

COMMENT ON COLUMN training_log_videos.performed_load IS
  'Athlete-stated load shown in the clip, for clips not tied to a logged set. When set_number is present the set row wins.';
COMMENT ON COLUMN training_log_videos.performed_reps IS
  'Athlete-stated rep count shown in the clip, for clips not tied to a logged set. When set_number is present the set row wins.';
