/**
 * bench — the engine, measured rather than argued about.
 *
 * P4's first deliverable (design §12: "benchmarking on labelled clips"). A
 * change to the tracker, the filter or the calibration either improves the
 * numbers or it does not, and until there is a way to run the same clips
 * through the same pipeline before and after, that question gets settled by
 * whoever describes their change most confidently. This settles it by
 * running it.
 *
 * It drives `verify/track-clip.html` — the harness that already accepts every
 * knob and reports every number — over a matrix of clips × variants, and
 * tabulates. Nothing here re-implements the pipeline, which is the point: a
 * benchmark with its own copy of the engine measures its own copy.
 *
 * Two kinds of case, and they answer different questions:
 *
 *   - **Labelled** (the synthetic clip, whose truth the page computes): the
 *     tracker's position RMS against where the plate actually was. An
 *     absolute number, in pixels, that a change makes better or worse.
 *   - **Unlabelled** (real footage): no truth exists, so the measure is
 *     AGREEMENT — two views of one lift should give one answer, and a
 *     variant is better when the gap between them shrinks. That is exactly
 *     the method `docs/KINEMOS_ACCURACY_STUDY.md` used to find the
 *     calibration bug, generalised.
 *
 * Usage:
 *
 *   npm run dev
 *   node verify/bench.mjs                 # the default matrix
 *   node verify/bench.mjs --json out.json # keep the numbers
 *   node verify/bench.mjs --only side     # cases whose name contains "side"
 *
 * Exit code is 1 when a case fails to produce a result, so this can gate a
 * change in CI once the fixtures live somewhere CI can see them.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BENCH_URL ?? 'http://127.0.0.1:5173/verify/track-clip.html';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 900_000);

/**
 * The matrix. A case is a clip plus the variants to run it under; every
 * variant of one clip is directly comparable, and `pair` marks two cases
 * that are two views of the same lift, so their agreement can be scored.
 */
const CASES = [
  {
    name: 'synthetic',
    labelled: true,
    query: 'synthetic=1&anchor=0,190.37,250.61&plate=190.37,250.61,34,34,0,45',
    variants: {
      default: '',
      'no-repair': '&norepair=1',
      'cutoff-6': '&cutoff=6',
      outline: '&outline=1',
    },
  },
  {
    name: 'traek-side',
    pair: 'traek',
    clip: '/verify/fixtures/real/Tr%C3%A6k%20side.webm',
    query: 'anchor=0&auto=1&plate=45&radius=28',
    variants: {
      default: '',
      'circle-fit': '&shape=circle',
      outline: '&outline=1&midpull=1',
      'cutoff-6': '&cutoff=6',
    },
  },
  {
    name: 'traek-oblique',
    pair: 'traek',
    clip: '/verify/fixtures/real/Tr%C3%A6k%20skr%C3%A5t.webm',
    query: 'anchor=0,244,218&auto=1&plate=45',
    variants: {
      default: '',
      'circle-fit': '&shape=circle',
      outline: '&outline=1&midpull=1',
      'cutoff-6': '&cutoff=6',
    },
  },
];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const jsonPath = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on('pageerror', e => console.log('  PAGEERROR', e.message));

const rows = [];
let failures = 0;

for (const testCase of CASES) {
  if (only && !testCase.name.includes(only)) continue;
  // A real clip that is not checked in is skipped rather than failed: the
  // fixtures are somebody's athletes and do not belong in the repository.
  if (testCase.clip && !existsSync(decodeURIComponent(`.${testCase.clip}`))) {
    console.log(`— ${testCase.name}: fixture not present, skipped`);
    continue;
  }
  for (const [variant, extra] of Object.entries(testCase.variants)) {
    const query = `${testCase.clip ? `clip=${testCase.clip}&` : ''}${testCase.query}${extra}`;
    process.stdout.write(`· ${testCase.name} / ${variant} … `);
    const started = Date.now();
    try {
      await page.goto(`${BASE}?${query}`);
      await page.waitForFunction(() => window.__DONE__ === true, null, { timeout: TIMEOUT_MS });
      const result = await page.evaluate(() => window.__RESULT__ ?? null);
      const truth = await page.evaluate(() => window.__TRUTH__ ?? null);
      if (!result) throw new Error('no result');

      let rmsPx = null;
      let worstPx = null;
      if (truth) {
        let sum = 0;
        let worst = 0;
        for (const [index, , x, y] of result.points) {
          const t = truth[index];
          if (!t) continue;
          const e = Math.hypot(x - t.x, y - t.y);
          sum += e * e;
          worst = Math.max(worst, e);
        }
        rmsPx = Math.sqrt(sum / result.points.length);
        worstPx = worst;
      }

      rows.push({
        case: testCase.name,
        pair: testCase.pair ?? null,
        variant,
        tracked: result.tracked,
        frames: result.frames,
        gaveUp: result.gaveUp,
        rmsPx,
        worstPx,
        vmax: result.summary?.peakVerticalVelocityMs ?? null,
        peakHeightCm: result.summary?.peakHeightCm ?? null,
        loopWidthCm: result.summary?.loopWidthCm ?? null,
        cmPerPxV: result.calibration?.cmPerPxV ?? null,
        jitterRms: result.jitterRms ?? null,
        seconds: (Date.now() - started) / 1000,
      });
      console.log('ok');
    } catch (e) {
      failures++;
      rows.push({ case: testCase.name, variant, error: e.message });
      console.log(`FAILED — ${e.message}`);
    }
  }
}

await browser.close();

// ── The table ──────────────────────────────────────────────────────────────
const fmt = (v, d = 3) => (v === null || v === undefined ? '—' : typeof v === 'number' ? v.toFixed(d) : String(v));
const header = ['case', 'variant', 'tracked', 'rms px', 'worst', 'Vmax', 'height cm', 'loop cm', 'jitter', 's'];
const table = rows.map(r =>
  r.error
    ? [r.case, r.variant, 'FAILED', r.error.slice(0, 40), '', '', '', '', '', '']
    : [
        r.case,
        r.variant,
        `${r.tracked}/${r.frames}${r.gaveUp ? '*' : ''}`,
        fmt(r.rmsPx),
        fmt(r.worstPx, 2),
        fmt(r.vmax),
        fmt(r.peakHeightCm, 1),
        fmt(r.loopWidthCm, 1),
        fmt(r.jitterRms, 2),
        fmt(r.seconds, 1),
      ],
);
const widths = header.map((h, i) => Math.max(h.length, ...table.map(row => String(row[i] ?? '').length)));
const line = cells => cells.map((c, i) => String(c ?? '').padEnd(widths[i])).join('  ');
console.log('');
console.log(line(header));
console.log(widths.map(w => '-'.repeat(w)).join('  '));
for (const row of table) console.log(line(row));

// ── Agreement between paired views ─────────────────────────────────────────
//
// The accuracy study's own measure: two views of one lift, one answer. A
// variant that narrows the gap is better even where no ground truth exists.
const pairs = new Map();
for (const r of rows) {
  if (!r.pair || r.error || r.vmax == null) continue;
  const key = `${r.pair}/${r.variant}`;
  if (!pairs.has(key)) pairs.set(key, []);
  pairs.get(key).push(r);
}
const agreements = [];
for (const [key, group] of pairs) {
  if (group.length !== 2) continue;
  const [a, b] = group;
  const gap = (v1, v2) => Math.abs(v1 - v2) / ((v1 + v2) / 2);
  agreements.push({
    pair: key,
    vmaxGapPct: gap(a.vmax, b.vmax) * 100,
    heightGapPct: gap(a.peakHeightCm, b.peakHeightCm) * 100,
  });
}
if (agreements.length > 0) {
  console.log('');
  console.log('agreement between paired views (lower is better)');
  console.log('pair/variant                  Vmax gap %   height gap %');
  for (const a of agreements.sort((x, y) => x.vmaxGapPct - y.vmaxGapPct)) {
    console.log(`${a.pair.padEnd(28)}  ${a.vmaxGapPct.toFixed(2).padStart(10)}   ${a.heightGapPct.toFixed(2).padStart(12)}`);
  }
}

if (jsonPath) {
  mkdirSync(jsonPath.replace(/\/[^/]*$/, '') || '.', { recursive: true });
  writeFileSync(jsonPath, JSON.stringify({ ranAt: new Date().toISOString(), rows, agreements }, null, 2));
  console.log(`\nwrote ${jsonPath}`);
}

process.exit(failures > 0 ? 1 : 0);
