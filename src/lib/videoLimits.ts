/**
 * videoLimits — what a video upload has to satisfy, per bucket, and the typed
 * errors raised when it doesn't.
 *
 * Split out of `trainingLogService` so surfaces that only need to *state* a
 * limit — the clip editor above all — don't drag the Supabase client in with
 * them. `trainingLogService` re-exports the log-video members, so existing
 * importers are unaffected.
 *
 * ## Why only one bucket has a byte cap
 *
 * `log-videos` is created by a migration and its `file_size_limit` is in the
 * repository, so the client can mirror it and reject an oversized clip before
 * spending the upload. `event-videos` and `planner-media` were created without
 * one, which means they inherit the *project's* global upload limit — a
 * Supabase dashboard setting no migration can see. Guessing it would reject
 * files the project would happily take, so those paths carry no client cap and
 * instead read storage's own refusal (`isStorageSizeRejection`) and turn it
 * into something an athlete can act on.
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
