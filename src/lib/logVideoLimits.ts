/**
 * logVideoLimits — the caps a training clip has to satisfy, and the errors
 * raised when it doesn't.
 *
 * Split out of `trainingLogService` so the surfaces that only need to *state*
 * a limit — the clip editor above all — don't drag the Supabase client in with
 * it. `trainingLogService` re-exports everything here, so existing importers
 * are unaffected.
 */

/**
 * Mirrors the bucket's own `file_size_limit` so the UI can reject an oversized
 * file before spending the upload rather than after.
 *
 * It must stay equal to the 209715200 in
 * `supabase/migrations/20260828120000_add_training_log_videos.sql` — it drifted
 * to 400 MB once, which meant every clip between 200 and 400 MB passed our
 * check and then came back from storage as the raw, unactionable "The object
 * exceeded the maximum allowed size". The real product cap is duration (below);
 * the byte cap is only the bucket's edge.
 */
export const LOG_VIDEO_MAX_BYTES = 200 * 1024 * 1024;

/** Longest clip an athlete may attach. Duration, not bytes, is what a coach
 *  actually reviews — one lift plus setup fits comfortably in a minute.
 *  COACH-CONFIG candidate. */
export const LOG_VIDEO_MAX_SECONDS = 60;

/**
 * A clip the bucket will not accept.
 *
 * Its own type so the upload UI can offer the one thing that actually helps —
 * re-encoding the clip smaller — instead of only printing a limit.
 */
export class VideoTooLargeError extends Error {
  readonly sizeBytes: number;
  readonly limitBytes = LOG_VIDEO_MAX_BYTES;
  constructor(sizeBytes: number) {
    super(
      `Video is ${Math.round(sizeBytes / 1024 / 1024)} MB — the limit is ` +
        `${LOG_VIDEO_MAX_BYTES / 1024 / 1024} MB. Trim it to the lift, or shrink it, and try again.`,
    );
    this.name = 'VideoTooLargeError';
    this.sizeBytes = sizeBytes;
  }
}

/** A clip longer than the product cap. Same reasoning as VideoTooLargeError:
 *  the caller can offer to trim rather than just refuse. */
export class VideoTooLongError extends Error {
  readonly seconds: number;
  readonly limitSeconds = LOG_VIDEO_MAX_SECONDS;
  constructor(seconds: number) {
    super(
      `Video is ${Math.round(seconds)} s long — the limit is ${LOG_VIDEO_MAX_SECONDS} s. ` +
        'Trim it to the lift and try again.',
    );
    this.name = 'VideoTooLongError';
    this.seconds = seconds;
  }
}
