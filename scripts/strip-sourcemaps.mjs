// Delete every .map file from dist/ after a build.
//
// vite builds with sourcemap: 'hidden' (see vite.config.ts): the
// //# sourceMappingURL comment is omitted, but the .map file is still
// WRITTEN. Publishing dist wholesale therefore put a ~15 MB map at
// /assets/index-*.js.map — the complete EMOS source, readable by anyone at a
// guessable URL. Nothing fetches it at runtime (that is what 'hidden' means),
// so deleting it from the deploy costs nothing.
//
// Production stacks stay mappable: check out the SHA the error log reports
// (the app records "0.60.1 (8fdb265)") and run `npm run build` — the local
// build reproduces the same bundle offsets, so the map is one command away
// without shipping the source to the public.
//
// This lives in a Node script rather than a `find ... -delete` in the deploy
// command so it runs identically on Windows, on Cloudflare's Linux builder,
// and on Netlify.
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not URL.pathname: on Windows the latter yields '/C:/...'.
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));

async function stripMaps(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    console.error(`strip-sourcemaps: ${dir} not found — did the build run?`);
    process.exit(1);
  }

  let removed = 0;
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) removed += await stripMaps(full);
    else if (entry.name.endsWith('.map')) {
      await rm(full);
      removed += 1;
    }
  }
  return removed;
}

const removed = await stripMaps(DIST);
console.log(`strip-sourcemaps: removed ${removed} .map file(s) from dist/`);
