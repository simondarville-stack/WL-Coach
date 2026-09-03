/**
 * Screenshot the trends bench in each of its states, so a change to the chart
 * can be looked at rather than inferred from a jsdom assertion.
 *
 *   1. npm run dev                          (serves /verify/trends-preview.html)
 *   2. npm i --no-save playwright-core      (not a project dependency)
 *   3. OUT=/tmp/trends node verify/shoot-trends.mjs
 *
 * Writes numbered PNGs to $OUT (default ./verify/out). CHROME overrides the
 * browser binary.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const S = process.env.OUT ?? './verify/out';
mkdirSync(S, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 200)); });
const shot = (name) => page.screenshot({ path: `${S}/${name}.png`, fullPage: false });

await page.goto('http://localhost:5173/verify/trends-preview.html');
await page.getByText('PEAK VELOCITY · M/S').waitFor();
await page.waitForTimeout(300);
await shot('01-time');

// hover a rep via its table row: the mark gets a ring and the header the readout
await page.getByRole('row').nth(6).hover();
await page.waitForTimeout(150);
await shot('02-hover');
await page.mouse.move(0, 0);

await page.getByRole('button', { name: 'Against load' }).click();
await page.waitForTimeout(200);
await shot('03-load');

await page.getByRole('button', { name: 'All exercises' }).click();
await page.waitForTimeout(200);
await shot('04-all-load');

await page.getByRole('button', { name: 'Over time' }).click();
await page.waitForTimeout(200);
await shot('05-all-time');

await page.getByRole('button', { name: 'This exercise' }).click();
await page.getByRole('button', { name: '3 m' }).click();
await page.waitForTimeout(200);
await shot('06-3m');

await page.getByRole('button', { name: 'All', exact: true }).click();
const recompute = page.getByRole('button', { name: /RECOMPUTE/ });
console.log('recompute label:', await recompute.textContent());
await recompute.click();
await page.waitForTimeout(250);
await shot('07-recomputing');
await page.getByText(/recomputed/).waitFor();
await page.waitForTimeout(300);
await shot('08-recomputed');

await page.setViewportSize({ width: 1024, height: 700 });
await page.waitForTimeout(300);
await shot('09-narrow');

await page.goto('http://localhost:5173/verify/trends-preview.html?few=1');
await page.getByText('PEAK VELOCITY · M/S').waitFor();
await page.waitForTimeout(300);
await shot('10-single');

await page.goto('http://localhost:5173/verify/trends-preview.html?empty=1');
await page.waitForTimeout(500);
await shot('11-empty');
await browser.close();
