/**
 * A Vite config for the KinEMOS browser harnesses that never reloads.
 *
 * The normal dev server sends a full page reload to every client whenever an
 * edit fails to find an HMR boundary — and on a shared working tree that is
 * every edit anyone makes to the planner. A harness holding a sixty-second
 * bar track loses it each time. This config serves the same sources with HMR
 * and the file watcher off: reload by hand when you have changed something.
 *
 * Deliberately not derived from the app config: the harnesses need the
 * TypeScript transform and static serving, nothing else, and importing the
 * app config here drags its Node-only typings into the app's typecheck.
 *
 *     npx vite --port 5299 --strictPort --config verify/vite.bench.config.ts
 */
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    hmr: false,
    watch: null,
  },
});
