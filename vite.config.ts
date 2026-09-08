import { defineConfig, type Plugin } from 'vite';
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

// Computed once so the bundle's own provenance and the manifest it is
// compared against can never disagree within one build.
const buildSha = gitSha();
const buildTime = new Date().toISOString();

// Emit dist/version.json: the same provenance the bundle carries, as a file
// the running app can fetch to learn which build is live. A tab resuming
// after a long absence compares it with its own APP_VERSION/BUILD_SHA and
// reloads on a mismatch (src/lib/staleBundleReload.ts). It sits next to
// index.html, outside /assets/, so the immutable cache rule never applies;
// public/_headers marks it no-store as well.
function versionManifest(): Plugin {
  return {
    name: 'emos-version-manifest',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version: pkg.version, sha: buildSha, builtAt: buildTime }),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), versionManifest()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(buildSha),
    __BUILD_TIME__: JSON.stringify(buildTime),
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
  server: {
    // `vite dev` serves assets only — the /api/* worker (worker/index.ts) is
    // not in front of it, so KinEMOS video upload/playback would 404 in
    // development. Run `npx wrangler dev` alongside `npm run dev` and this
    // forwards /api to it; without it, KinEMOS import reports storage as
    // unconfigured and the rest of the app is unaffected.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
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
