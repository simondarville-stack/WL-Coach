/**
 * staleBundleReload — recover a tab left open across a deploy.
 *
 * EMOS ships as hashed, immutable chunks behind an uncached index.html. A tab
 * (or installed PWA) that stays open while a new version deploys keeps running
 * the old build: nothing reloads index.html for it, and every lazy route it
 * has not visited yet imports a chunk by a hash the new deploy no longer
 * serves. Vite reports that failure as a `vite:preloadError` event on window.
 *
 * Reload once when that happens, so the tab picks up the current build rather
 * than stranding the coach on a stale one (2026-09-06: a phone still on 0.90.0
 * failed to open KinEMOS against the 0.91.1 deploy, and kept exhibiting a bug
 * the deploy had fixed). One reload per minute at most — a genuine outage must
 * surface as an error, not a reload loop.
 */

const FLAG_KEY = 'emos:stale-bundle-reloaded-at';
const MIN_INTERVAL_MS = 60_000;

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

export function installStaleBundleReload(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', event => {
    const now = Date.now();
    if (now - lastReloadAt() < MIN_INTERVAL_MS) return; // let the error surface
    event.preventDefault();
    rememberReload(now);
    window.location.reload();
  });
}
