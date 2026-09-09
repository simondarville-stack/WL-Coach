/**
 * apiOrigin — where the `/api/*` routes live.
 *
 * EMOS is a static SPA; its only server-side code is the Cloudflare Worker in
 * `worker/index.ts`, which sits in front of the assets on the Cloudflare
 * deployment ONLY. The same bundle also runs from hosts that have no worker:
 * the Netlify rollback deploy that athletes' old bookmarks still open, a
 * `vite preview`, a file served from anywhere else. There a relative
 * `/api/kinemos/video/<key>` is answered by the SPA fallback with
 * `index.html` — a 200 that renders as a broken image and, for a PUT, looks
 * like a successful upload that stored nothing.
 *
 * So an `/api` URL is built against `VITE_API_ORIGIN` when the build sets
 * one (`.env.production` points at the live Cloudflare host), and stays
 * relative otherwise — `vite dev` proxies `/api` to a local `wrangler dev`,
 * and on the Cloudflare host itself the relative form is already right.
 */

/** Normalise a configured origin: trim, drop a trailing slash, and treat
 *  anything that is not an absolute http(s) origin as "not configured". */
export function resolveApiOrigin(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/]+$/.test(trimmed) ? trimmed : '';
}

/** The origin this build addresses its `/api` routes to — '' for relative. */
export const API_ORIGIN = resolveApiOrigin(import.meta.env.VITE_API_ORIGIN);

/** An absolute (or, unconfigured, relative) URL for an `/api/...` path. */
export function apiUrl(path: string, origin: string = API_ORIGIN): string {
  return `${origin}${path}`;
}
