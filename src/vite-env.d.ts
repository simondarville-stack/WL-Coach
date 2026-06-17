/// <reference types="vite/client" />

// Build-time constants injected by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

interface ImportMetaEnv {
  /**
   * Optional soft-gate passphrase for the coach app (the root, non-/athlete
   * area). When set at build time, the coach UI shows a one-time access-code
   * prompt; once unlocked the choice persists in localStorage. Leave it UNSET
   * in local dev so there's never a prompt while developing.
   *
   * This is deterrence, not security: like every VITE_ var the value is
   * inlined into the public client bundle. It only raises the bar against
   * casual snooping until real auth lands.
   */
  readonly VITE_COACH_GATE?: string;
}
