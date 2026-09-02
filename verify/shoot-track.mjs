/**
 * Drive `verify/track-clip.html` headlessly and keep what it produced.
 *
 *   npm run dev
 *   npm i --no-save playwright-core
 *   OUT=/tmp/track QUERY='clip=/verify/fixtures/x.mp4&anchor=3,180,210&plate=180,210,22,21,0,45' node verify/shoot-track.mjs
 *
 * Writes `log.txt`, `result.json` (window.__RESULT__) and one PNG per canvas
 * the page drew — the anchor frame with the track over it, the bar path in
 * centimetres, the velocity curve, or the numbered frame dumps in `?frame=`
 * mode — into $OUT.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const OUT = process.env.OUT ?? './verify/out/track';
const QUERY = process.env.QUERY ?? 'synthetic=1&anchor=0,190.37,250.61&plate=190.37,250.61,34,34,0,45';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
await page.goto(`http://localhost:5173/verify/track-clip.html?${QUERY}`);
await page.waitForFunction(() => window.__DONE__ === true, null, { timeout: 120_000 });

const log = await page.locator('#log').textContent();
writeFileSync(`${OUT}/log.txt`, log ?? '');
console.log(log);

const result = await page.evaluate(() => window.__RESULT__ ?? null);
if (result) writeFileSync(`${OUT}/result.json`, JSON.stringify(result));
const truth = await page.evaluate(() => window.__TRUTH__ ?? null);
if (truth && result) {
  let sum = 0, worst = 0;
  for (const [index, , x, y] of result.points) {
    const t = truth[index];
    const e = Math.hypot(x - t.x, y - t.y);
    sum += e * e; worst = Math.max(worst, e);
  }
  console.log(`vs ground truth: rms ${Math.sqrt(sum / result.points.length).toFixed(3)} px, worst ${worst.toFixed(3)} px`);
}

const canvases = await page.locator('#frames canvas').all();
for (const c of canvases) {
  const id = (await c.getAttribute('id')) ?? 'canvas';
  await c.screenshot({ path: `${OUT}/${id}.png` });
}
console.log(`wrote ${canvases.length} canvases to ${OUT}`);
await browser.close();
