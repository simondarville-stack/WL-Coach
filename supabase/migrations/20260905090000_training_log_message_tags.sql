-- Tagged comments (0.91.0): a coach reviewing a training log can tag the
-- comment to the thing it is about — one logged exercise or one metric the
-- athlete entered — instead of writing "the snatch" and hoping the athlete
-- reads it against the right row.
--
-- The tag rides on the message row as a jsonb array (`tags`), shape
-- `MessageTag` in src/lib/database.types.ts:
--   {"kind":"exercise","logExerciseId":"<training_log_exercises.id>","label":"Snatch"}
--   {"kind":"metric","key":"bw","label":"BW","value":"82,5 kg"}
-- The message text carries the same tag as a plain `@Snatch` token, so the
-- row reads correctly on any surface that ignores this column.
--
-- Why not the existing `exercise_id` column: several surfaces (the athlete
-- Today screen, coach Log mode's session thread) hide messages whose
-- exercise_id is set, treating them as a separate per-exercise scope with
-- no UI behind it. A tagged comment is still a session-level message; the
-- tag is what it points at. Leaving exercise_id null keeps it visible
-- everywhere.
--
-- Rollback:
--   ALTER TABLE training_log_messages DROP COLUMN IF EXISTS tags;

ALTER TABLE training_log_messages
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE training_log_messages
  DROP CONSTRAINT IF EXISTS training_log_messages_tags_is_array;
ALTER TABLE training_log_messages
  ADD CONSTRAINT training_log_messages_tags_is_array
  CHECK (jsonb_typeof(tags) = 'array');
