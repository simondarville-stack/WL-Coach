/**
 * Gesture checks for the KinEMOS viewer, driven with a real browser pointer.
 *
 * The viewer's pointer maths has no unit test and the most ways to be quietly
 * wrong: client coordinates converted through a scaled canvas's own rect,
 * times converted through a band's width, a drag that has to survive pointer
 * capture, a crosshair read out of a chart's rect onto an aligned clock. jsdom
 * cannot exercise any of it — there is no layout, so every
 * `getBoundingClientRect()` is zero — and dispatching synthetic events by hand
 * tests the dispatcher more than the component.
 *
 * So this drives the design bench with a real pointer and reads the state back
 * through `window.__BENCH__`.
 *
 *   1. npm run dev
 *   2. npm i --no-save playwright-core       (not a project dependency)
 *   3. node verify/drive-gestures.mjs
 *
 * Set CHROME to a browser binary if the default path is not right for your
 * machine. Exits non-zero when a check fails, so CI can run it if it ever
 * gains a browser.
 */
const URL = process.env.BENCH_URL ?? 'http://127.0.0.1:5173/verify/viewer-preview.html';
const CHROME = process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('playwright-core is not installed. Run: npm i --no-save playwright-core');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', e => errors.push(e.message));

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
const bench = () => page.evaluate('window.__BENCH__');

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForFunction('window.__BENCH__ !== undefined', null, { timeout: 60000 });

  // ── Marking on the stage ──────────────────────────────────────────────────
  //
  // The canvas is 1280 px wide inside a box about 1000 px wide, so a handler
  // that reads clientX without going through the element's rect lands in the
  // wrong place — by more the further from the left edge the click is.
  const box = await page.locator('canvas').first().boundingBox();
  const before = await bench();
  const fx = 0.42;
  const fy = 0.63;
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  await page.waitForTimeout(150);
  const after = await bench();

  check('A click on the stage places a mark', after.marks.length === before.marks.length + 1);
  if (after.marks.length) {
    const mark = after.marks[after.marks.length - 1];
    const error = Math.hypot(mark.x - fx * after.stage.width, mark.y - fy * after.stage.height);
    check(
      'The mark lands where the pointer was, through the canvas scale',
      error < 4,
      `off by ${error.toFixed(2)} px of a ${after.stage.width}×${after.stage.height} frame`,
    );
  }

  // ── Dragging a phase edge ─────────────────────────────────────────────────
  const strip = await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(
      d => d.style.cursor === 'pointer' && d.style.height === '30px',
    );
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

  const snapshot = await bench();
  const boundaries = snapshot.boundaries;
  // The band's x-domain is the SERIES, not the boundary range — the first
  // boundary is lift-off, well inside the clip.
  const { from: t0, to: t1 } = snapshot.domain;
  const fractionOf = t => (t - t0) / (t1 - t0 || 1);

  const edgeT = boundaries[1].t;
  const targetT = edgeT + 0.18;
  const midY = strip.y + strip.height / 2;

  await page.mouse.move(strip.x + strip.width * fractionOf(edgeT), midY);
  await page.mouse.down();
  await page.mouse.move(strip.x + strip.width * fractionOf(targetT), midY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const moved = (await bench()).boundaries;
  check(
    'Dragging a phase edge moves it',
    Math.abs(moved[1].t - edgeT) > 0.05,
    `${edgeT.toFixed(3)} s → ${moved[1].t.toFixed(3)} s`,
  );
  check(
    'It lands where the pointer was released',
    Math.abs(moved[1].t - targetT) < 0.05,
    `wanted ${targetT.toFixed(3)} s, got ${moved[1].t.toFixed(3)} s`,
  );
  check('And it becomes the coach’s, not a proposal', moved[1].source === 'coach', moved[1].source);
  check(
    'The edges either side stay put',
    Math.abs(moved[0].t - boundaries[0].t) < 1e-6 &&
      Math.abs(moved[2].t - boundaries[2].t) < 1e-6,
  );
  check(
    'Boundaries stay in order',
    moved.every((b, i) => i === 0 || b.t >= moved[i - 1].t),
  );
  // ── Comparison: the crosshair and the exaggeration ────────────────────────
  //
  // Two more pieces of maths with no unit test: client x through a chart's own
  // rect into a time on the aligned clock, and an x-only scale applied to a
  // path whose vertical must not move with it.
  await page.getByRole('button', { name: /compare/i }).click();
  await page.waitForTimeout(200);
  const picker = page.locator('select').first();
  const options = await picker.evaluate(el => [...el.options].map(o => o.value).filter(Boolean));
  if (options.length) await picker.selectOption(options[0]);
  await page.waitForTimeout(300);

  // The readout is "t +0,97 s  0,28  0,32  +0,04 m/s" — comma decimals and a
  // typographic minus, per the display conventions.
  const readout = async () => {
    const text = await page
      .locator('header', { hasText: 'VERTICAL VELOCITY' })
      .first()
      .innerText();
    const numbers = [...text.matchAll(/[−+-]?\d+,\d+/g)].map(m =>
      Number(m[0].replace('−', '-').replace(',', '.')),
    );
    return numbers.length >= 4
      ? { t: numbers[0], reference: numbers[1], current: numbers[2], delta: numbers[3] }
      : null;
  };

  const chart = await page.locator('div[style*="crosshair"]').first().boundingBox();
  const samples = [];
  for (const fraction of [0.25, 0.5, 0.75]) {
    await page.mouse.move(chart.x + chart.width * fraction, chart.y + chart.height / 2);
    await page.waitForTimeout(80);
    samples.push(await readout());
  }

  check(
    'Hovering the velocity chart reads a moment out of it',
    samples.every(s => s !== null),
  );
  if (samples.every(s => s !== null)) {
    check(
      'The clock runs left to right',
      samples[0].t < samples[1].t && samples[1].t < samples[2].t,
      samples.map(s => `${s.t.toFixed(2)} s`).join(' → '),
    );
    // Equal steps in x must be equal steps in time, or the rect is not being
    // used and the reading drifts the further right the pointer goes.
    const first = samples[1].t - samples[0].t;
    const second = samples[2].t - samples[1].t;
    check(
      'Equal pointer steps are equal time steps',
      Math.abs(first - second) < 0.03,
      `${first.toFixed(3)} s then ${second.toFixed(3)} s`,
    );
    const worst = Math.max(
      ...samples.map(s => Math.abs(s.delta - (s.current - s.reference))),
    );
    check(
      'The gap shown is the gap between the two numbers shown',
      worst <= 0.011,
      `worst disagreement ${worst.toFixed(3)} m/s`,
    );
  }

  await page.mouse.move(chart.x + chart.width / 2, chart.y - 60);
  await page.waitForTimeout(120);
  check(
    'Leaving the chart puts the alignment caption back',
    (await page.locator('header', { hasText: 'VERTICAL VELOCITY' }).first().innerText()).includes(
      't = 0',
    ),
  );

  // Exaggeration: the path must get wider and stay exactly as tall.
  const pathBox = () =>
    page.evaluate(() => {
      const el = [...document.querySelectorAll('path')].find(
        p => p.getAttribute('stroke') === '#185FA5',
      );
      const b = el.getBBox();
      return { width: b.width, height: b.height };
    });
  const atOne = await pathBox();
  await page.getByRole('button', { name: '×4', exact: true }).click();
  await page.waitForTimeout(150);
  const atFour = await pathBox();

  check(
    'Exaggerating stretches the path by exactly the stated factor',
    Math.abs(atFour.width / atOne.width - 4) < 0.01,
    `×${(atFour.width / atOne.width).toFixed(3)}`,
  );
  check(
    'And leaves the vertical alone — the height is the measurement',
    Math.abs(atFour.height - atOne.height) < 0.01,
    `${atOne.height.toFixed(2)} → ${atFour.height.toFixed(2)} cm`,
  );

  check('No page errors', errors.length === 0, errors.join(' | '));
} catch (err) {
  check('The driver ran without throwing', false, String(err?.message ?? err));
} finally {
  await browser.close();
}

for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  — ${c.detail}` : ''}`);
}
const failed = checks.filter(c => !c.ok).length;
console.log(`\n${failed} failed of ${checks.length}`);
process.exit(failed ? 1 : 0);
