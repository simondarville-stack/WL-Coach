/*
  # Add skipped_reason to training_log_sessions

  1. Changes
    - Add `skipped_reason` TEXT column to `training_log_sessions`
      - Stores the athlete's reason when a whole session is marked
        "not done" (status = 'skipped') — e.g. sick, injured, travelling.
      - Nullable; NULL for any session that was not skipped.

  2. Notes
    - The reason is athlete-authored log data, kept separate from
      `session_notes` (free session notes) so neither overwrites the other —
      single source of truth per concept.
    - No enum/CHECK is introduced for the reason: it is free text, keeping
      the not-done taxonomy runtime-flexible (coach/athlete are not locked to
      a fixed list). The UI offers presets as sugar only.
    - `status` already accepts 'skipped' (free-text column, no CHECK), so no
      change is needed there.
*/

ALTER TABLE training_log_sessions
  ADD COLUMN IF NOT EXISTS skipped_reason text DEFAULT NULL;
