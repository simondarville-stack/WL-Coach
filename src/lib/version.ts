/**
 * App version — single source of truth for what's shown in the UI and attached
 * to error logs.
 *
 * The number lives in package.json "version" and is injected at build time
 * (see vite.config.ts). To cut a new version, bump it there and redeploy.
 *
 * Scheme: semantic versioning on the 0.x line while EMOS is in beta
 * (0.MINOR.PATCH) — MINOR for features, PATCH for fixes. The leading 0 marks
 * pre-1.0/beta; we move to 1.0.0 at the first stable release.
 */
export const APP_VERSION = __APP_VERSION__;   // e.g. "0.1.0"
export const BUILD_SHA = __BUILD_SHA__;       // short git commit ("unknown" if git unavailable)
export const BUILD_TIME = __BUILD_TIME__;     // ISO timestamp of the build

/** Compact label for display, e.g. "v0.1.0". */
export const VERSION_LABEL = `v${APP_VERSION}`;

/** Build date in European format (DD.MM.YYYY HH:mm), for tooltips/diagnostics. */
function formatBuildTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Full provenance string, e.g. "EMOS v0.1.0 · 1a2b3c4 · 01.06.2026 14:30". */
export const BUILD_INFO = `EMOS ${VERSION_LABEL} · ${BUILD_SHA} · ${formatBuildTime(BUILD_TIME)}`;
