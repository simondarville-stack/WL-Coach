/**
 * kinemosStorage — the browser's side of the KinEMOS R2 routes.
 *
 * Direct imports are the long-form footage the Supabase video buckets refuse
 * at 200 MB: a whole competition session, a full training set, a seminar clip.
 * They go to R2 through `worker/index.ts`, which holds the bucket binding —
 * so nothing here carries a credential, and there is no presigned URL with a
 * clock on it to expire halfway through a 250 MB upload on gym wifi.
 *
 * Object keys are v4 UUIDs (`<uuid>.mp4`, poster `<uuid>.jpg`) and the row in
 * `kinemos_videos` stores the KEY, never a URL — `videoUrl()` builds the URL
 * at read time. Baking an origin into stored rows is precisely how the
 * Netlify-era links rotted when hosting moved.
 */

/** Client-side cap, mirrored by KINEMOS_MAX_BYTES in the worker. Deliberately
 *  looser than the 200 MB log-video bucket because whole-session footage is
 *  the reason direct import exists. COACH-CONFIG candidate. */
export const KINEMOS_IMPORT_MAX_BYTES = 300 * 1024 * 1024;

/** Extensions the worker's key validator accepts for a clip. */
const CLIP_EXTENSIONS = ['mp4', 'webm', 'mov'] as const;

/** Storage is not configured (no R2 binding), as opposed to a transport
 *  failure — the import UI says "storage unavailable" rather than "upload
 *  failed", because the fix is a deploy, not a retry. */
export class KinemosStorageUnavailableError extends Error {
  constructor() {
    super('KinEMOS video storage is not configured on this deployment.');
    this.name = 'KinemosStorageUnavailableError';
  }
}

export class KinemosUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KinemosUploadError';
  }
}

/** URL a <video> (or an <img>, for a poster) reads the object from. */
export function kinemosObjectUrl(key: string): string {
  return `/api/kinemos/video/${encodeURIComponent(key)}`;
}

/** Shared write token, when this deployment sets one (KINEMOS_WRITE_TOKEN on
 *  the worker, VITE_KINEMOS_TOKEN at build time). Drive-by filtering for the
 *  open PUT/DELETE routes during the no-auth phase — see worker/index.ts. */
function writeHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = import.meta.env.VITE_KINEMOS_TOKEN as string | undefined;
  return token ? { ...extra, 'x-kinemos-token': token } : extra;
}

/** A fresh key for a picked file, honouring its container so the worker
 *  serves the right content-type. Unknown containers become .mp4 — every
 *  path that produces one here has already been through the clip editor,
 *  which outputs MP4. */
export function newClipKey(fileName: string): string {
  const raw = fileName.includes('.') ? fileName.split('.').pop()! : '';
  const ext = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const chosen = (CLIP_EXTENSIONS as readonly string[]).includes(ext) ? ext : 'mp4';
  return `${crypto.randomUUID()}.${chosen}`;
}

/** The poster key that belongs to a clip key — same UUID, .jpg. Derived
 *  rather than stored separately so the pair can never drift apart. */
export function posterKeyFor(clipKey: string): string {
  return `${clipKey.slice(0, clipKey.lastIndexOf('.'))}.jpg`;
}

async function put(key: string, body: Blob): Promise<void> {
  let res: Response;
  try {
    res = await fetch(kinemosObjectUrl(key), {
      method: 'PUT',
      body,
      headers: writeHeaders({ 'content-type': body.type || 'application/octet-stream' }),
    });
  } catch {
    throw new KinemosUploadError('Upload failed — check the connection and try again.');
  }
  if (res.status === 503) throw new KinemosStorageUnavailableError();
  if (res.status === 413) {
    throw new KinemosUploadError(
      `Clip is ${Math.round(body.size / 1024 / 1024)} MB — the limit is ` +
        `${Math.round(KINEMOS_IMPORT_MAX_BYTES / 1024 / 1024)} MB. Trim it, or drop the size, to import it.`,
    );
  }
  if (!res.ok) throw new KinemosUploadError('Upload failed — the clip was not stored.');
}

/** Upload a clip. Returns the key to store on the row. */
export async function uploadClip(file: File): Promise<string> {
  if (file.size > KINEMOS_IMPORT_MAX_BYTES) {
    throw new KinemosUploadError(
      `Clip is ${Math.round(file.size / 1024 / 1024)} MB — the limit is ` +
        `${Math.round(KINEMOS_IMPORT_MAX_BYTES / 1024 / 1024)} MB. Trim it, or drop the size, to import it.`,
    );
  }
  const key = newClipKey(file.name);
  await put(key, file);
  return key;
}

/** Upload the poster frame beside an already-stored clip. Best-effort: a
 *  missing poster costs a library tile its thumbnail and nothing else, so a
 *  failure here must never fail the import. */
export async function uploadPoster(clipKey: string, poster: Blob): Promise<string | null> {
  const key = posterKeyFor(clipKey);
  try {
    await put(key, poster);
    return key;
  } catch {
    return null;
  }
}

/** Remove an object. Idempotent worker-side, and best-effort here: an
 *  orphaned object is a wasted few megabytes, while a throw would leave the
 *  caller unable to delete the row it belongs to. */
export async function deleteObject(key: string): Promise<void> {
  await fetch(kinemosObjectUrl(key), { method: 'DELETE', headers: writeHeaders() }).catch(
    () => undefined,
  );
}
