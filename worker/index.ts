/**
 * EMOS Worker — API routes running in front of the static assets.
 *
 * Only `/api/*` reaches this script (assets.run_worker_first in
 * wrangler.toml); every other request is served straight from the built
 * assets and never touches this code, so a bug here cannot take the app
 * itself down.
 *
 * Current surface: Cloudflare Stream upload brokering. The Stream API token
 * must never reach the browser, so the SPA asks this worker for a one-time
 * direct-upload URL and posts the clip there itself.
 *
 * INERT until three secrets are set (wrangler secret put / Workers Builds
 * variables) — without them every Stream route answers 503
 * stream-not-configured and the client falls back to Supabase storage:
 *   STREAM_ACCOUNT_ID    — Cloudflare account id
 *   STREAM_API_TOKEN     — API token with Stream:Edit on that account
 *   STREAM_CUSTOMER_CODE — the customer-<code> subdomain from the Stream
 *                          dashboard, used to build playback URLs
 */
interface Env {
  STREAM_ACCOUNT_ID?: string;
  STREAM_API_TOKEN?: string;
  STREAM_CUSTOMER_CODE?: string;
}

/** Matches LOG_VIDEO_MAX_SECONDS client-side, plus slack so a clip that a
 *  phone reports as 60.4 s does not die at the door. */
const MAX_DURATION_SECONDS = 65;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

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

    return json({ error: 'not-found' }, 404);
  },
};
