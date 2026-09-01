/**
 * videoLimits — what a video upload has to satisfy, per bucket, and the typed
 * errors raised when it doesn't.
 *
 * Split out of `trainingLogService` so surfaces that only need to *state* a
 * limit — the clip editor above all — don't drag the Supabase client in with
 * them. `trainingLogService` re-exports the log-video members, so existing
 * importers are unaffected.
 *
 * ## Keeping the caps honest
 *
 * Every bucket's `file_size_limit` is declared in a migration, so the numbers
 * below can mirror them and the UI can refuse an oversized file before
 * spending the upload rather than after:
 *
 *   - `log-videos`     — 20260828120000_add_training_log_videos.sql
 *   - `event-videos`   — 20260901090000_video_bucket_size_limits.sql
 *   - `planner-media`  — 20260901090000_video_bucket_size_limits.sql
 *
 * `isStorageSizeRejection` stays the backstop underneath all of them: the
 * *project's* global upload limit can be lower than any bucket's, and that one
 * lives in the Supabase dashboard where no migration can reach it.
 */

/**
 * The `file_size_limit` every video bucket declares — the 209715200 in the
 * migrations listed above.
 *
 * It must stay equal to them. On log-videos it drifted to 400 MB once, which
 * meant every clip between 200 and 400 MB passed our check and then came back
 * from storage as the raw, unactionable "The object exceeded the maximum
 * allowed size".
 */
const VIDEO_BUCKET_MAX_BYTES = 200 * 1024 * 1024;

/** Cap on a training-log clip. The real product cap is duration (below); the
 *  byte cap is only the bucket's edge. */
export const LOG_VIDEO_MAX_BYTES = VIDEO_BUCKET_MAX_BYTES;

/** Cap on competition attempt footage (`event-videos`). No duration cap: a
 *  whole attempt — walk-on, lift, down signal — is not one lift. */
export const EVENT_VIDEO_MAX_BYTES = VIDEO_BUCKET_MAX_BYTES;

/** Cap on a coach's demo video or reference image (`planner-media`). */
export const PLANNER_MEDIA_MAX_BYTES = VIDEO_BUCKET_MAX_BYTES;

/** Longest clip an athlete may attach. Duration, not bytes, is what a coach
 *  actually reviews — one lift plus setup fits comfortably in a minute.
 *  COACH-CONFIG candidate. */
export const LOG_VIDEO_MAX_SECONDS = 60;

/**
 * A video the storage layer will not accept.
 *
 * Its own type so the upload UI can offer the one thing that actually helps —
 * re-encoding the video smaller — instead of only printing a limit.
 * `limitBytes` is null on the buckets whose ceiling lives in the Supabase
 * dashboard rather than in a migration (see the module note above).
 */
export class VideoTooLargeError extends Error {
  readonly sizeBytes: number;
  readonly limitBytes: number | null;
  constructor(sizeBytes: number, limitBytes: number | null = null) {
    const size = Math.round(sizeBytes / 1024 / 1024);
    super(
      limitBytes == null
        ? `Video is ${size} MB and storage refused it as too large. ` +
            'Trim it, or shrink it, and try again.'
        : `Video is ${size} MB — the limit is ${Math.round(limitBytes / 1024 / 1024)} MB. ` +
            'Trim it to the lift, or shrink it, and try again.',
    );
    this.name = 'VideoTooLargeError';
    this.sizeBytes = sizeBytes;
    this.limitBytes = limitBytes;
  }
}

/** A clip longer than the product cap. Same reasoning as VideoTooLargeError:
 *  the caller can offer to trim rather than just refuse. */
export class VideoTooLongError extends Error {
  readonly seconds: number;
  readonly limitSeconds: number;
  constructor(seconds: number, limitSeconds: number = LOG_VIDEO_MAX_SECONDS) {
    super(
      `Video is ${Math.round(seconds)} s long — the limit is ${limitSeconds} s. ` +
        'Trim it to the lift and try again.',
    );
    this.name = 'VideoTooLongError';
    this.seconds = seconds;
    this.limitSeconds = limitSeconds;
  }
}

/**
 * Recognise storage's own size rejection.
 *
 * The backstop behind every byte cap: the project's global upload limit can be
 * lower than a bucket's, and it is set in the Supabase dashboard where no
 * migration can mirror it. Rather than let that surface as "The object
 * exceeded the maximum allowed size" on an athlete's phone, every upload path
 * maps it onto `VideoTooLargeError`.
 */
export function isStorageSizeRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const status = (error as { statusCode?: string | number } | null)?.statusCode;
  return (
    /maximum allowed size|payload too large|entity too large/i.test(message) ||
    String(status ?? '') === '413'
  );
}
