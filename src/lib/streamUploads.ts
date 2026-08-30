/**
 * streamUploads — optional Cloudflare Stream path for training clips.
 *
 * OFF by default. Turns on when the build sets VITE_STREAM_UPLOADS=1 AND the
 * worker's Stream secrets are configured (see worker/index.ts). When on,
 * uploadLogVideo sends clips to Stream (adaptive playback, real thumbnails)
 * instead of raw MP4s in Supabase storage; any failure on the Stream path
 * falls back to the storage path, so enabling this can never lose a clip.
 *
 * A Stream clip's video_url is its iframe embed URL
 * (customer-<code>.cloudflarestream.com/<uid>/iframe); the playback surfaces
 * branch on isStreamPlaybackUrl and render an iframe instead of <video>.
 */

/** Build-time switch. Ordinary builds leave this unset and never call /api. */
export const STREAM_UPLOADS_ENABLED = import.meta.env.VITE_STREAM_UPLOADS === '1';

/** Basic direct-creator uploads cap out at 200 MB on Stream; larger files
 *  (rare under the 60 s duration cap) stay on the storage path. */
const STREAM_MAX_BYTES = 190 * 1024 * 1024;

export interface StreamUploadResult {
  uid: string;
  /** iframe embed URL — stored as the clip's video_url. */
  playbackUrl: string;
}

export function isStreamPlaybackUrl(url: string): boolean {
  return /\.cloudflarestream\.com\//.test(url);
}

/** Server-rendered poster for a Stream clip (replaces the #t=0.1 trick). */
export function streamThumbnailUrl(playbackUrl: string): string {
  return playbackUrl.replace(/\/iframe$/, '/thumbnails/thumbnail.jpg');
}

export function streamUidFromUrl(playbackUrl: string): string | null {
  return playbackUrl.match(/cloudflarestream\.com\/([a-f0-9]+)\/iframe/)?.[1] ?? null;
}

/** True when this file should even attempt the Stream path. */
export function streamEligible(file: File): boolean {
  return STREAM_UPLOADS_ENABLED && file.size <= STREAM_MAX_BYTES;
}

/**
 * Upload one clip to Stream via the worker-brokered one-time URL.
 * Throws on any failure — the caller falls back to Supabase storage.
 */
export async function uploadToStream(file: File): Promise<StreamUploadResult> {
  const brokered = await fetch('/api/stream/direct-upload', { method: 'POST' });
  if (!brokered.ok) throw new Error('stream-unavailable');
  const { uploadUrl, uid, playbackUrl } = (await brokered.json()) as {
    uploadUrl: string;
    uid: string;
    playbackUrl: string;
  };
  const form = new FormData();
  form.append('file', file);
  const up = await fetch(uploadUrl, { method: 'POST', body: form });
  if (!up.ok) throw new Error('stream-upload-failed');
  return { uid, playbackUrl };
}

/** Free the Stream copy of a deleted clip. Best-effort — a failure leaves an
 *  orphaned Stream video, never a broken row. */
export async function deleteStreamVideo(uid: string): Promise<void> {
  await fetch(`/api/stream/video/${uid}`, { method: 'DELETE' }).catch(() => undefined);
}
