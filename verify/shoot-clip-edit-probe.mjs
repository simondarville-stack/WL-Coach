/**
 * Run the clip-edit geometry probe headless and print a table.
 *
 *   1. npm run dev                          (serves /verify/clip-edit-probe.html)
 *   2. npm i --no-save playwright-core      (not a project dependency)
 *   3. node verify/shoot-clip-edit-probe.mjs
 *
 * Exits non-zero when any edited output is not round, has an unexpected size,
 * fails the pre-upload check, or when the deliberately squeezed file passes
 * it. CHROME overrides the browser binary.
 */
import { chromium } from 'playwright-core';

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 300));
});
await page.goto(process.env.URL ?? 'http://localhost:5173/verify/clip-edit-probe.html');
await page.waitForFunction(() => window.__probe !== undefined, null, { timeout: 900_000 });
const res = await page.evaluate(() => window.__probe);
await browser.close();

if (!Array.isArray(res)) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(1);
}

let failures = 0;
for (const s of res) {
  console.log(`\n${s.source}`);
  for (const m of s.measures) {
    const squeezed = m.name.startsWith('SQUEEZED');
    const verdict = m.verdict ? (m.verdict.ok ? (m.verdict.checked ? 'ok' : 'unchecked') : `REFUSED ${m.verdict.reason}`) : '-';
    const round = m.circle ? Math.abs(m.circle.ratio - 1) <= 0.02 : false;
    let bad = false;
    if (m.error) bad = true;
    else if (squeezed) bad = m.verdict?.ok !== false;
    else if (m.name !== 'SOURCE') bad = !round || m.verdict?.ok !== true;
    if (bad) failures++;
    console.log(
      `  ${bad ? '✗' : '✓'} ${m.name.padEnd(48)} video ${String(m.videoWidth + '×' + m.videoHeight).padEnd(10)} rot ${String(m.rotation).padEnd(4)} circle ${m.circle ? m.circle.ratio.toFixed(3) : '-'}  gate ${verdict.padEnd(22)} ${m.corners}${m.error ? '  ERROR ' + m.error : ''}`,
    );
  }
}
console.log(failures === 0 ? '\nall clear' : `\n${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
