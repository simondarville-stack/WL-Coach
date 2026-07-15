-- Backfill owner_id on session-bound messages written before the
-- fill-from-session trigger existed.
--
-- Why: every coach-facing message read filters on owner_id
-- (fetchInboxUnreadCount, fetchCoachInboxThreads). A session-bound
-- message inserted before trg_training_log_messages_fill_from_session
-- was added kept owner_id NULL, so it matched no coach's filter — real
-- athlete messages that the coach could never see or reply to, and that
-- the unread badge could never count.
--
-- Migration 20260526000001 backfilled athlete_id but not owner_id; this
-- closes that gap using the same rule the trigger applies to new rows:
-- inherit from the message's session. Additive only — untouched unless
-- owner_id IS NULL and the session resolves.
--
-- Note: this makes previously-invisible unread athlete messages appear in
-- the coach inbox, which is the intended outcome (they were never read).

UPDATE training_log_messages m
SET owner_id = s.owner_id
FROM training_log_sessions s
WHERE m.session_id = s.id
  AND m.owner_id IS NULL
  AND s.owner_id IS NOT NULL;

-- Same rule for athlete_id, in case any row predates the 20260526000001
-- backfill as well. No-op when that migration already covered them.
UPDATE training_log_messages m
SET athlete_id = s.athlete_id
FROM training_log_sessions s
WHERE m.session_id = s.id
  AND m.athlete_id IS NULL
  AND s.athlete_id IS NOT NULL;
