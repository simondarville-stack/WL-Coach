/**
 * EMOS Worker — API routes running in front of the static assets.
 *
 * Only `/api/*` reaches this script (assets.run_worker_first in
 * wrangler.toml); every other request is served straight from the built
 * assets and never touches this code, so a bug here cannot take the app
 * itself down.
 *
 * Two surfaces live here:
 *
 * 1. **Cloudflare Stream upload brokering.** The Stream API token must never
 *    reach the browser, so the SPA asks this worker for a one-time
 *    direct-upload URL and posts the clip there itself.
 *
 *    INERT until three secrets are set (wrangler secret put / Workers Builds
 *    variables) — without them every Stream route answers 503
 *    stream-not-configured and the client falls back to Supabase storage:
 *      STREAM_ACCOUNT_ID    — Cloudflare account id
 *      STREAM_API_TOKEN     — API token with Stream:Edit on that account
 *      STREAM_CUSTOMER_CODE — the customer-<code> subdomain from the Stream
 *                             dashboard, used to build playback URLs
 *
 * 2. **KinEMOS video objects in R2** (`/api/kinemos/video/*`). Direct imports
 *    into the analysis module are long-form footage — a whole competition
 *    session, a full training set — which the Supabase video buckets refuse at
 *    200 MB. R2 takes them through a native bucket binding, so no S3
 *    credentials exist to leak and no presigned-URL clock can expire mid-
 *    upload. Inert (503) until the binding is configured, exactly like Stream.
 *
 *    Interim access model, consistent with the public Supabase video buckets
 *    the app already serves from: the object key is a v4 UUID and therefore
 *    the capability. Rows in `kinemos_videos` carry `owner_id`, so the future
 *    auth/RLS phase can put a real check in front of these routes without
 *    moving any object.
 */

/** Minimal structural view of the R2 binding — hand-rolled to match this
 *  file's existing Env style rather than pulling in @cloudflare/workers-types
 *  for three method signatures. */
interface R2Range {
  offset?: number;
  length?: number;
  suffix?: number;
}
interface R2Object {
  size: number;
  httpEtag: string;
  range?: R2Range;
  body: ReadableStream;
  writeHttpMetadata(headers: Headers): void;
}
interface R2Bucket {
  get(
    key: string,
    options?: { range?: Headers },
  ): Promise<R2Object | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
}

interface Env {
  STREAM_ACCOUNT_ID?: string;
  STREAM_API_TOKEN?: string;
  STREAM_CUSTOMER_CODE?: string;
  KINEMOS_VIDEOS?: R2Bucket;
  /**
   * Optional shared token for KinEMOS writes (PUT/DELETE). When set, those
   * methods require a matching `x-kinemos-token` header; GET stays open (the
   * UUID key is the read capability, same as the public Supabase buckets).
   *
   * This is drive-by filtering, not auth: the token is baked into the client
   * bundle (VITE_KINEMOS_TOKEN) and anyone who extracts it is in. What it
   * stops is the anonymous internet using an open PUT as free R2 storage, or
   * walking DELETE against leaked keys. The real check arrives with the
   * auth/billing phase. Unset = open, matching the interim access model.
   */
  KINEMOS_WRITE_TOKEN?: string;
}

/** Matches LOG_VIDEO_MAX_SECONDS client-side, plus slack so a clip that a
 *  phone reports as 60.4 s does not die at the door. */
const MAX_DURATION_SECONDS = 65;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A KinEMOS object key: a v4 UUID plus an allow-listed extension, flat in the
 * bucket. Validated rather than trusted because the key comes straight off the
 * URL — anything looser lets a caller write outside the namespace or fetch a
 * neighbouring object by guessing a path.
 *
 * `<uuid>.jpg` is the clip's poster frame; the rest are clip containers.
 */
const KINEMOS_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(mp4|webm|mov|jpg)$/;

/** Mirrors KINEMOS_IMPORT_MAX_BYTES client-side. The client checks first so an
 *  oversized pick fails before the upload is spent; this is the backstop for a
 *  caller that skips it. */
const KINEMOS_MAX_BYTES = 300 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  jpg: 'image/jpeg',
};

/**
 * Serve one object, honouring Range.
 *
 * Range is not an optimisation here: scrubbing a video element to an arbitrary
 * frame is *implemented* as a range request, so an analysis viewer over a
 * range-less endpoint would have to download the whole clip to seek one second
 * into it.
 */
async function serveKinemosObject(bucket: R2Bucket, key: string, request: Request): Promise<Response> {
  const ranged = request.headers.has('range');
  const object = await bucket.get(key, ranged ? { range: request.headers } : undefined);
  if (!object) return json({ error: 'not-found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // Keys are UUIDs and objects are never rewritten, so a clip fetched once
  // never needs fetching again.
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('accept-ranges', 'bytes');

  if (ranged && object.range) {
    // R2 answers a suffix range ("last N bytes") with {suffix}; both forms
    // have to become an absolute content-range for the browser.
    const { offset, length, suffix } = object.range;
    const start = suffix != null ? Math.max(0, object.size - suffix) : offset ?? 0;
    const end = suffix != null ? object.size - 1 : start + (length ?? object.size - start) - 1;
    headers.set('content-range', `bytes ${start}-${end}/${object.size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/stream/direct-upload' && request.method === 'POST') {
      if (!env.STREAM_ACCOUNT_ID || !env.STREAM_API_TOKEN || !env.STREAM_CUSTOMER_CODE) {
        return json({ error: 'stream-not-configured' }, 503);
      }
      const apiRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.STREAM_ACCOUNT_ID}/stream/direct_upload`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.STREAM_API_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ maxDurationSeconds: MAX_DURATION_SECONDS }),
        },
      );
      const body = (await apiRes.json().catch(() => null)) as {
        success?: boolean;
        result?: { uploadURL?: string; uid?: string };
      } | null;
      if (!apiRes.ok || !body?.success || !body.result?.uploadURL || !body.result.uid) {
        return json({ error: 'stream-api-error' }, 502);
      }
      return json({
        uploadUrl: body.result.uploadURL,
        uid: body.result.uid,
        playbackUrl: `https://customer-${env.STREAM_CUSTOMER_CODE}.cloudflarestream.com/${body.result.uid}/iframe`,
      });
    }

    // Clip deletion, so removing a log video also frees the Stream copy.
    const del = url.pathname.match(/^\/api\/stream\/video\/([a-f0-9]{16,64})$/);
    if (del && request.method === 'DELETE') {
      if (!env.STREAM_ACCOUNT_ID || !env.STREAM_API_TOKEN) {
        return json({ error: 'stream-not-configured' }, 503);
      }
      const apiRes = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${env.STREAM_ACCOUNT_ID}/stream/${del[1]}`,
        { method: 'DELETE', headers: { authorization: `Bearer ${env.STREAM_API_TOKEN}` } },
      );
      // 404 counts as gone — deletes must be idempotent for retries.
      if (!apiRes.ok && apiRes.status !== 404) return json({ error: 'stream-api-error' }, 502);
      return json({ ok: true });
    }

    // ---- KinEMOS video objects in R2 -------------------------------------
    const kin = url.pathname.match(/^\/api\/kinemos\/video\/(.+)$/);
    if (kin) {
      const key = decodeURIComponent(kin[1]);
      if (!KINEMOS_KEY.test(key)) return json({ error: 'bad-key' }, 400);
      const bucket = env.KINEMOS_VIDEOS;
      if (!bucket) return json({ error: 'kinemos-storage-not-configured' }, 503);

      if (request.method === 'GET' || request.method === 'HEAD') {
        return serveKinemosObject(bucket, key, request);
      }

      // Writes are gated by the shared token where one is configured — see
      // KINEMOS_WRITE_TOKEN in Env for what this does and does not protect.
      if (
        env.KINEMOS_WRITE_TOKEN &&
        request.headers.get('x-kinemos-token') !== env.KINEMOS_WRITE_TOKEN
      ) {
        return json({ error: 'forbidden' }, 403);
      }

      if (request.method === 'PUT') {
        if (!request.body) return json({ error: 'empty-body' }, 400);
        // content-length is advisory (a streamed upload may omit it), so this
        // rejects the clearly-oversized early rather than guaranteeing a cap.
        const declared = Number(request.headers.get('content-length') ?? '0');
        if (declared > KINEMOS_MAX_BYTES) {
          return json({ error: 'too-large', limitBytes: KINEMOS_MAX_BYTES }, 413);
        }
        const ext = key.slice(key.lastIndexOf('.') + 1);
        await bucket.put(key, request.body, {
          httpMetadata: { contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' },
        });
        return json({ ok: true, key });
      }

      if (request.method === 'DELETE') {
        // R2 deletes are already idempotent — a missing key is not an error.
        await bucket.delete(key);
        return json({ ok: true });
      }

      return json({ error: 'method-not-allowed' }, 405);
    }

    return json({ error: 'not-found' }, 404);
  },
};
