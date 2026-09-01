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
    // CI builders may hand over a shallow/bare checkout where `git` is
    // unavailable. Each platform exports the commit it built, so fall back to
    // that rather than losing provenance in the deployed app and error logs.
    const ciSha =
      process.env.WORKERS_CI_COMMIT_SHA ?? // Cloudflare Workers Builds
      process.env.CF_PAGES_COMMIT_SHA ?? // Cloudflare Pages
      process.env.COMMIT_REF; // Netlify
    return ciSha ? ciSha.slice(0, 7) : 'unknown';
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
    // 'hidden' emits .map files but omits the //# sourceMappingURL comment, so
    // browsers/devtools don't auto-load them. The maps let a captured
    // production stack (e.g. the in-app error log's "index-*.js:704:107058")
    // be mapped back to a real file/line — without them, "Script error."
    // stacks stay opaque.
    //
    // They are NOT deployed: `npm run build:deploy` runs
    // scripts/strip-sourcemaps.mjs to delete dist/**/*.map after the build,
    // because 'hidden' only hides the comment, not the file — publishing
    // dist wholesale exposed the entire source at a guessable URL. Local builds
    // keep the map, and a build of the same SHA reproduces the same offsets, so
    // mapping a production stack still works.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // Name the clip-editor's encoder chunk. It is already split out (only
        // `videoClipEdit.ts` imports it, and only via a dynamic import, so an
        // athlete who never trims a clip never downloads it) — but Rollup
        // names it after mediabunny's own `index.js`, which reads like the app
        // entry in the network tab and in any future size audit.
        manualChunks(id: string) {
          if (id.includes('node_modules/mediabunny/')) return 'mediabunny';
          return undefined;
        },
      },
    },
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
