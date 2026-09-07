/**
 * staleBundleReload — recover a tab left open across a deploy.
 *
 * EMOS ships as hashed, immutable chunks behind an uncached index.html. A tab
 * (or installed PWA) that stays open while a new version deploys keeps running
 * the old build: nothing reloads index.html for it, and every lazy route it
 * has not visited yet imports a chunk by a hash the new deploy no longer
 * serves. Two recoveries, in the order they were needed:
 *
 * 1. React to the failure. Vite reports a missing chunk as a
 *    `vite:preloadError` event on window; reload once when that happens, so
 *    the tab picks up the current build rather than stranding the coach on a
 *    stale one (2026-09-06: a phone still on 0.90.0 failed to open KinEMOS
 *    against the 0.91.1 deploy, and kept exhibiting a bug the deploy had
 *    fixed).
 *
 * 2. Get ahead of it. Phones keep a tab alive for weeks: the error log held
 *    an athlete on 0.45.0 in September against a 0.9x deploy, and every
 *    chunk failure in the log came from a build ten to thirty versions
 *    behind. So when the page becomes visible again after a long absence —
 *    the natural "new visit" boundary, before anything has been typed — ask
 *    the server which build is live (`/version.json`, written by the build,
 *    served uncached) and reload if it is not this one. A short absence
 *    (switching apps between sets) never reloads.
 *
 * One reload per minute at most, shared by both paths — a genuine outage must
 * surface as an error, not a reload loop. Error capture is suspended once a
 * reload is decided, so the page's own teardown does not file rows.
 */
import { suspendCapture } from './errorLogger';
import { APP_VERSION, BUILD_SHA } from './version';

const FLAG_KEY = 'emos:stale-bundle-reloaded-at';
const MIN_INTERVAL_MS = 60_000;

/** Written by the build (vite.config.ts) next to index.html; never cached. */
export const VERSION_MANIFEST_PATH = '/version.json';

/** How long the tab must have been hidden before a resume checks the build. */
export const RESUME_CHECK_AFTER_HIDDEN_MS = 10 * 60_000;

export interface VersionManifest {
  version: string;
  sha: string;
  builtAt: string;
}

export function parseVersionManifest(value: unknown): VersionManifest | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<Record<keyof VersionManifest, unknown>>;
  if (typeof v.version !== 'string' || typeof v.sha !== 'string') return null;
  return {
    version: v.version,
    sha: v.sha,
    builtAt: typeof v.builtAt === 'string' ? v.builtAt : '',
  };
}

/**
 * Whether the served build differs from the one running. Two deploys of the
 * same version differ by SHA, so the SHA decides whenever both sides know
 * theirs; a build without git provenance ("unknown") falls back to the
 * version string. Equal on both counts — or no manifest — means stay put.
 */
export function isDifferentBuild(
  remote: VersionManifest | null,
  local: { version: string; sha: string },
): boolean {
  if (!remote) return false;
  const shaKnown = (s: string) => s !== '' && s !== 'unknown';
  if (shaKnown(remote.sha) && shaKnown(local.sha)) return remote.sha !== local.sha;
  return remote.version !== local.version;
}

/** The resume rule: visible again after at least `threshold` ms hidden. */
export function resumedAfterLongAbsence(
  hiddenAt: number | null,
  now: number,
  threshold: number = RESUME_CHECK_AFTER_HIDDEN_MS,
): boolean {
  return hiddenAt !== null && now - hiddenAt >= threshold;
}

function lastReloadAt(): number {
  try {
    const raw = sessionStorage.getItem(FLAG_KEY);
    return raw ? Number(raw) || 0 : 0;
  } catch {
    return 0;
  }
}

function rememberReload(now: number): void {
  try {
    sessionStorage.setItem(FLAG_KEY, String(now));
  } catch {
    // Storage unavailable (private mode / quota): still reload, just without
    // the loop guard — the interval check below then falls back to allowing it.
  }
}

/** Reload unless one happened within the last minute. Returns whether it did. */
function reloadOnce(now: number): boolean {
  if (now - lastReloadAt() < MIN_INTERVAL_MS) return false;
  rememberReload(now);
  suspendCapture();
  window.location.reload();
  return true;
}

async function fetchLiveBuild(): Promise<VersionManifest | null> {
  try {
    const res = await fetch(VERSION_MANIFEST_PATH, { cache: 'no-store' });
    if (!res.ok) return null;
    // The SPA fallback answers a missing file with index.html and a 200, so
    // trust the body only when the server says it is JSON.
    if (!(res.headers.get('content-type') ?? '').includes('json')) return null;
    return parseVersionManifest(await res.json());
  } catch {
    return null; // offline, or a captive portal — try again on the next resume
  }
}

let checking = false;

async function reloadIfBuildChanged(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const live = await fetchLiveBuild();
    if (isDifferentBuild(live, { version: APP_VERSION, sha: BUILD_SHA })) {
      reloadOnce(Date.now());
    }
  } finally {
    checking = false;
  }
}

export function installStaleBundleReload(): void {
  if (typeof window === 'undefined') return;

  window.addEventListener('vite:preloadError', event => {
    if (reloadOnce(Date.now())) event.preventDefault();
    // otherwise let the error surface
  });

  // No manifest is served under `vite dev`, and HMR handles staleness there.
  if (import.meta.env.DEV) return;

  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (resumedAfterLongAbsence(hiddenAt, Date.now())) void reloadIfBuildChanged();
    hiddenAt = null;
  });
}
