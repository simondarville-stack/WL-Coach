import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Version provenance, injected at build time so the running app can show
// exactly which build is online. `version` in package.json is the single
// source of truth (bump it to cut a release); the git SHA + build time
// disambiguate redeploys made between version bumps.
const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string };

function gitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    // 'hidden' emits .map files but omits the //# sourceMappingURL comment,
    // so browsers/devtools don't auto-load them (source isn't surfaced in the
    // UI) — yet the maps are deployed, letting a captured production stack
    // (e.g. the in-app error log's "index-*.js:634:101479") be mapped back to
    // a real file/line. Without these, iOS "Script error." stacks are opaque.
    sourcemap: 'hidden',
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
  },
});
