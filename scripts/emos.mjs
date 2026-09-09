// Launcher for the EMOS assistant CLI (scripts/emos-cli.ts).
//
// The CLI shares src/lib modules with the app, and those use extensionless
// imports that Node's ESM loader will not resolve — so this bundles the CLI
// with esbuild (already a dependency through vite) into node_modules/.cache
// and runs it. Packages stay external; only the repo's own TypeScript is
// bundled. Run as `npm run emos -- <command> ...`.
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter yields '/C:/...'.
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ENTRY = fileURLToPath(new URL('./emos-cli.ts', import.meta.url));
const OUT_DIR = `${ROOT}node_modules/.cache/emos/`;
const OUT = `${OUT_DIR}emos-cli.mjs`;

await mkdir(OUT_DIR, { recursive: true });
await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: 'inline',
  logLevel: 'warning',
});

process.env.EMOS_ROOT = ROOT;
await import(pathToFileURL(OUT).href);
