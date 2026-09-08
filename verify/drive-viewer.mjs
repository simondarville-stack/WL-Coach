/**
 * Walk the KinEMOS viewer in a real Chrome against a real library clip, and
 * keep what it looked like.
 *
 *   1. Point vite's /api proxy at the deployment that holds the clips (or run
 *      the worker), and start the dev server on 5244 (`kinemos-dev`).
 *   2. npm i --no-save playwright-core
 *   3. CLIP=direct/<kinemos_videos.id> node verify/drive-viewer.mjs
 *
 * Every tool is used, the panels are opened, the clip is played and stepped,
 * and a PNG is written for each state into $OUT (verify/out/viewer). Console
 * errors and page errors are collected and printed at the end; the exit code
 * is non-zero when a check fails.
 *
 * Uses the installed Chrome (CHROME), not Playwright's Chromium: the clips are
 * H.264 and HEVC, which the bundled Chromium cannot decode.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5244';
const CLIP = process.env.CLIP ?? 'direct/89396322-763d-415a-a872-5c01eb354ba3';
const OUT = process.env.OUT ?? './verify/out/viewer';
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const WIDTH = Number(process.env.WIDTH ?? 1440);
const HEIGHT = Number(process.env.HEIGHT ?? 900);
const HEADLESS = process.env.HEADED ? false : true;
/** Skip everything that writes to the clip's analysis: for a clip whose
 *  track is real. */
const READONLY = !!process.env.READONLY;
mkdirSync(OUT, { recursive: true });

const coach = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Simon',
  email: null,
  photo_url: null,
  club_name: null,
  locale: 'en',
  created_at: '2026-04-05T17:48:23.107Z',
  updated_at: '2026-04-05T17:48:23.107Z',
};

const browser = await chromium.launch({ executablePath: CHROME, headless: HEADLESS });
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
await context.addInitScript(profile => {
  localStorage.setItem(
    'emos-coach',
    JSON.stringify({ state: { activeCoach: profile, coaches: [profile] }, version: 0 }),
  );
}, coach);
const page = await context.newPage();

const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => {
  if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`);
});

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};
let shot = 0;
const snap = async name => {
  const file = `${OUT}/${String(++shot).padStart(2, '0')}-${name}.png`;
  try {
    await page.screenshot({ path: file, timeout: 20000 });
    console.log(`shot ${file}`);
  } catch (err) {
    console.log(`shot ${name} FAILED: ${err.message.split('\n')[0]}`);
  }
};
const text = async () => page.evaluate(() => document.body.innerText);
const frameCounter = async () => {
  const t = await text();
  const m = t.match(/frame (\d+) \/ (\d+)/);
  return m ? { index: Number(m[1]), count: Number(m[2]) } : null;
};
const stageBox = async () => page.locator('section[aria-label="Video"] canvas').first().boundingBox();
const clickStage = async (fx, fy) => {
  const box = await stageBox();
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(150);
};
const readoutAfter = async label => {
  const t = await text();
  const i = t.indexOf(label);
  return i < 0 ? null : t.slice(i, i + 160).replace(/\s+/g, ' ');
};

try {
  await page.goto(`${BASE}/kinemos/analysis/${CLIP}`, { waitUntil: 'networkidle' });
  await page.locator('section[aria-label="Video"] canvas').first().waitFor({ timeout: 90000 });
  let opened = null;
  for (let k = 0; k < 40 && !opened; k++) {
    await page.waitForTimeout(250);
    opened = await frameCounter();
  }
  check('The clip opens on a decoded frame', opened !== null && opened.count > 1, JSON.stringify(opened));
  await snap('open');

  // ── Depth presets ────────────────────────────────────────────────────────
  await page.getByText('Work', { exact: true }).first().click();
  await page.waitForTimeout(400);
  const t0 = await text();
  check('Work opens every panel', /7 of 7 panels open/.test(t0), t0.match(/\d of 7 panels open/)?.[0]);
  await snap('work-top');
  const rail = page.locator('div[style*="overflow-y: auto"]').last();
  await rail.evaluate(el => el.scrollTo(0, el.scrollHeight / 2));
  await page.waitForTimeout(200);
  await snap('work-middle');
  await rail.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await page.waitForTimeout(200);
  await snap('work-bottom');
  await rail.evaluate(el => el.scrollTo(0, 0));

  // ── Stepping and playback ────────────────────────────────────────────────
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  const stepped = await frameCounter();
  check('Three → steps land on frame 4', stepped?.index === 4, JSON.stringify(stepped));
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(600);
  const jumped = await frameCounter();
  check('⇧→ jumps ten frames', jumped?.index === 14, JSON.stringify(jumped));
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(400);
  check('← steps back', (await frameCounter())?.index === 13);

  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  await page.getByText('1×', { exact: true }).first().click();
  await page.keyboard.press(' ');
  await page.waitForTimeout(2000);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  const played = await frameCounter();
  const fps = Number((await text()).match(/([\d,.]+) fps/)?.[1].replace(',', '.') ?? 0);
  check(
    'Two seconds of play at 1× advance about two seconds of frames',
    played !== null && played.index > fps * 1.2 && played.index < fps * 2.8,
    `frame ${played?.index} of ${played?.count} at ${fps} fps`,
  );
  await snap('after-play');

  // ── Tools ────────────────────────────────────────────────────────────────
  await page.keyboard.press('Home');
  await page.waitForTimeout(300);

  // Distance: two clicks.
  await page.keyboard.press('d');
  await clickStage(0.3, 0.4);
  await clickStage(0.7, 0.4);
  const distance = await readoutAfter('DISTANCE');
  check('Distance shows a value after two clicks', distance !== null && !/—/.test(distance.slice(0, 80)), distance ?? 'no readout');
  await snap('distance');

  // Angle: two arms then the vertex.
  await page.keyboard.press('a');
  await clickStage(0.3, 0.3);
  await clickStage(0.7, 0.3);
  await clickStage(0.5, 0.6);
  const angle = await readoutAfter('ANGLE');
  const angleValue = angle?.match(/(\d+,\d)°/)?.[1];
  check('Angle shows a value after three clicks', angleValue !== undefined, angle ?? 'no readout');
  // The two arms are symmetric about the vertex: the angle is what the geometry says.
  // Only an uncalibrated clip reports the screen angle; a calibrated one
  // corrects for the viewing angle, and the distance readout says which.
  if (angleValue && /px/.test(distance ?? '')) {
    const box = await stageBox();
    const ax = 0.3 * box.width, ay = 0.3 * box.height, bx = 0.7 * box.width, by = 0.3 * box.height, vx = 0.5 * box.width, vy = 0.6 * box.height;
    const expected = (Math.acos(((ax - vx) * (bx - vx) + (ay - vy) * (by - vy)) / (Math.hypot(ax - vx, ay - vy) * Math.hypot(bx - vx, by - vy))) * 180) / Math.PI;
    check('The angle is the screen angle (uncalibrated)', Math.abs(Number(angleValue.replace(',', '.')) - expected) < 1.5, `${angleValue}° vs ${expected.toFixed(1)}° expected`);
  }
  await snap('angle');
  const keep = page.getByRole('button', { name: 'Keep it' });
  check('Keep it is offered for a complete angle', await keep.count() === 1);

  // Knee.
  if (!READONLY) {
  await page.keyboard.press('k');
  await clickStage(0.5, 0.75);
  const knee = await readoutAfter('KNEE');
  check('Knee readout appears', knee !== null, knee ?? 'no readout');
  await snap('knee');
  }

  if (!READONLY) {
  // Calibrate: one click plants the ellipse.
  await page.keyboard.press('c');
  await clickStage(0.5, 0.8);
  await page.waitForTimeout(300);
  const ellipses = await page.locator('section[aria-label="Video"] svg ellipse').count();
  check('Calibrate plants a plate outline', ellipses === 1, `${ellipses} ellipse(s)`);
  await snap('calibrate');

  // Mark: one click is a point.
  await page.keyboard.press('m');
  await clickStage(0.5, 0.5);
  await page.waitForTimeout(300);
  const marks = await page.locator('section[aria-label="Video"] svg circle[fill="#FFFFFF"]').count();
  check('Mark places a point on the stage', marks >= 1, `${marks} white circle(s)`);
  await snap('mark');
  }

  if (READONLY) {
    const refButtons = await page.getByRole('button', { name: /Set as reference|Reference lift/ }).count();
    const refEnabled = await page.getByRole('button', { name: /Set as reference|Reference lift/ }).first().isEnabled().catch(() => false);
    check('An analysed clip offers Set as reference', refButtons >= 1 && refEnabled, `${refButtons} button(s), enabled ${refEnabled}`);
    const compare = await page.getByRole('button', { name: /Compare/ }).first().isEnabled().catch(() => false);
    check('Compare is offered', compare);
  }
  // Nothing in the rail is clipped: no panel is wider than the rail, and
  // the rail itself keeps its minimum whatever the clip's orientation.
  const clipped = await page.evaluate(() => {
    const rail = [...document.querySelectorAll('div')].find(d => d.style.overflowY === 'auto' && d.querySelector('section'));
    if (!rail) return { rail: 0, over: ['no rail'] };
    const over = [...rail.querySelectorAll('section')]
      .filter(sec => sec.scrollWidth > sec.clientWidth + 1)
      .map(sec => `${sec.querySelector('button')?.textContent?.slice(0, 30) ?? '?'}: ${sec.scrollWidth} > ${sec.clientWidth}`);
    return { rail: rail.clientWidth, over };
  });
  check('The rail is at least 320 px wide', clipped.rail >= 320, `${clipped.rail} px`);
  check('No rail panel is wider than the rail', clipped.over.length === 0, clipped.over.join(' | '));

  // The measurement figures are drawn at screen size: an angle is two rays
  // and an arc, a distance a line, each with its value beside it.
  await page.keyboard.press('a');
  await clickStage(0.3, 0.3);
  await clickStage(0.7, 0.3);
  await clickStage(0.5, 0.6);
  const angleFigure = await page.evaluate(() => {
    const svg = document.querySelector('section[aria-label="Video"] svg');
    const arc = svg?.querySelector('path');
    const rays = svg?.querySelector('polyline');
    const labels = [...(svg?.querySelectorAll('text') ?? [])].map(t => t.textContent);
    const r = svg?.querySelector('circle[fill="#7FD1B9"]');
    const box = svg?.getBoundingClientRect();
    const vb = svg?.viewBox.baseVal;
    const onScreen = r && box && vb ? (Number(r.getAttribute('r')) * box.width) / vb.width : 0;
    return { arc: !!arc, rays: !!rays, labels, pointRadiusPx: onScreen };
  });
  check('An angle is drawn as rays and an arc with its value', angleFigure.arc && angleFigure.rays && angleFigure.labels.some(l => /°/.test(l ?? '')), JSON.stringify(angleFigure));
  check('Measurement points are 5 px on screen whatever the clip size', Math.abs(angleFigure.pointRadiusPx - 5) < 0.6, `${angleFigure.pointRadiusPx.toFixed(2)} px`);
  await snap('angle-figure');
  await page.getByRole('button', { name: 'Discard' }).click();

  // The transport's readout sits on one line.
  const readoutHeight = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find(s => /^frame \d+ \/ \d+$/.test(s.textContent ?? ''));
    return el?.parentElement?.getBoundingClientRect().height ?? 0;
  });
  check('The frame counter is one line', readoutHeight > 0 && readoutHeight < 24, `${readoutHeight.toFixed(0)} px tall`);

  // The column splitters: a drag resizes, a double-click resets.
  const videoSection = page.locator('section[aria-label="Video"]');
  const before = (await videoSection.boundingBox()).width;
  const splitter = page.getByRole('separator', { name: 'Clip column width' });
  const sb = await splitter.boundingBox();
  await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2 - 40, sb.y + sb.height / 2, { steps: 4 });
  await page.mouse.move(sb.x + sb.width / 2 - 80, sb.y + sb.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = (await videoSection.boundingBox()).width;
  check('Dragging the clip splitter narrows the clip column by the drag', Math.abs(before - after - 80) < 3, `${before.toFixed(0)} to ${after.toFixed(0)} px`);
  await snap('splitter-dragged');
  const pathSplitter = page.getByRole('separator', { name: 'Bar-path column width' });
  const pb = await pathSplitter.boundingBox();
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width / 2 + 120, pb.y + pb.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await snap('path-splitter-dragged');
  await splitter.dblclick();
  await pathSplitter.dblclick();
  await page.waitForTimeout(300);
  const reset = (await videoSection.boundingBox()).width;
  check('Double-click resets the clip column', Math.abs(reset - before) < 3, `${reset.toFixed(0)} px`);
  const remembered = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('kinemos.viewer.columns')));
  check('A reset forgets the override', remembered.length === 0, remembered.join(','));

  // Look: pan by drag, zoom by wheel.
  await page.keyboard.press('v');
  const box = await stageBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(300);
  const zoomed = await page.getByRole('button', { name: /× — reset/ }).count();
  check('Wheel zooms and offers a reset', zoomed === 1);
  await snap('zoomed');
  await page.getByRole('button', { name: /× — reset/ }).click();

  // ── Narrow window ────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(600);
  await snap('narrow-1100');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(600);
  await snap('1280x720');
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
} catch (err) {
  check('The walk completed', false, err.message.split('\n')[0]);
  await snap('failure');
}

const failed = checks.filter(c => !c.ok);
console.log(`\n${checks.length - failed.length} of ${checks.length} checks passed`);
if (errors.length) {
  console.log(`\n${errors.length} browser error(s):`);
  for (const e of errors.slice(0, 20)) console.log('  ' + e);
}
writeFileSync(`${OUT}/report.json`, JSON.stringify({ clip: CLIP, checks, errors }, null, 2));
await browser.close();
process.exit(failed.length ? 1 : 0);
