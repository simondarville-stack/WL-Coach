/**
 * videoProbe — read a video file in the browser without uploading it.
 *
 * Duration for the upload guards, and a poster JPEG so every later tile is an
 * <img> rather than a <video> fetching byte ranges of a full MP4 just to paint
 * one frame. Both are pure DOM work with no data layer behind them, which is
 * why they live here and not in `trainingLogService`: the clip editor's gate
 * needs the duration probe and has no business pulling the Supabase client in
 * to get it. The service re-exports both, so existing importers are unaffected.
 */

/**
 * Read a video file's duration from its metadata, without uploading or
 * decoding frames. Resolves null when the browser cannot read it (exotic
 * container, iOS quirks) — callers should treat null as "unknown, allow"
 * rather than blocking a legitimate clip on a probe failure.
 */
export function readVideoDurationSeconds(file: File): Promise<number | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    const finish = (value: number | null) => {
      URL.revokeObjectURL(url);
      probe.removeAttribute('src');
      resolve(value);
    };
    probe.onloadedmetadata = () => {
      const d = probe.duration;
      finish(Number.isFinite(d) ? d : null);
    };
    probe.onerror = () => finish(null);
    // A probe that hangs (no metadata event) must not wedge the upload flow.
    window.setTimeout(() => finish(null), 5_000);
    probe.src = url;
  });
}

/** Longest edge of the poster JPEG captured at upload. Big enough for the
 *  chat-bubble tile on a retina phone, small enough to stay ~20-40 KB. */
const POSTER_MAX_EDGE = 480;

/**
 * Capture one frame of the clip as a small JPEG, client-side, before upload.
 * This is what makes every later tile an <img> instead of a <video> that
 * pulls byte ranges of the full MP4 just to paint a poster. Best-effort:
 * resolves null on any failure or after a timeout, and the upload proceeds
 * without a thumbnail (tiles fall back to the lazy <video> poster).
 */
export function captureVideoPoster(file: File): Promise<Blob | null> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let settled = false;
    const finish = (value: Blob | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), 8_000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    // Seek off frame zero (often black) once the first frame is decodable;
    // draw when the seek lands.
    video.onloadeddata = () => {
      try {
        video.currentTime = 0.1;
      } catch {
        window.clearTimeout(timer);
        finish(null);
      }
    };
    video.onseeked = () => {
      window.clearTimeout(timer);
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return finish(null);
      const scale = Math.min(1, POSTER_MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return finish(null);
      try {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => finish(b), 'image/jpeg', 0.72);
      } catch {
        finish(null);
      }
    };
    video.src = url;
  });
}
