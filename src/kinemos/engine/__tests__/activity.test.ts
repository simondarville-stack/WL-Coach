/**
 * The activity scan on thumbnails drawn to a known script.
 *
 * A 90 × 160 portrait thumbnail (a phone clip at `maxEdge` 160) at 30 fps:
 * a textured, noisy ground; a lifter — a flat rectangle whose top rises
 * through the pull and dips into the catch; and two plates, soft-edged
 * discs of radius 10 at the bar's row. The scale is a real one: a 45 cm
 * plate is 20 px across, so the 90 rows of a snatch are about 2 m and a
 * 1,0 s pull is a 2 m/s bar.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIFT_WINDOW_OPTIONS,
  activityAccumulator,
  activityOf,
  liftWindows,
  windowRanges,
  type ActivitySample,
  type LiftWindow,
  type Thumb,
} from '../activity';

const W = 90;
const H = 160;
const FPS = 30;

interface Scene {
  /** Row of the bar (the plates' centre). */
  barRow: number;
  /** Row of the lifter's head. */
  bodyTop: number;
  /** Horizontal shift of everything — a pan. */
  panX?: number;
  plateContrast?: number;
  bodyContrast?: number;
  /** Peak-to-peak uniform pixel noise. */
  noise?: number;
}

function renderThumb(scene: Scene, frame: number): Thumb {
  const { barRow, bodyTop, panX = 0, plateContrast = 120, bodyContrast = 50, noise = 6 } = scene;
  const data = new Float32Array(W * H);
  let seed = 7919 + frame * 104729;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648 - 0.5;
  };
  const plates = [
    { cx: 20 + panX, cy: barRow },
    { cx: 70 + panX, cy: barRow },
  ];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // A textured wall — racks, posters, a door — so a pan changes every
      // cell, as a gym's does.
      let v =
        40 +
        18 * Math.sin(((x - panX) * 2 * Math.PI) / 16) +
        12 * Math.sin((y * 2 * Math.PI) / 40) * Math.cos(((x - panX) * 2 * Math.PI) / 30);
      const bx = x - panX;
      if (bx >= 32 && bx < 58 && y >= bodyTop && y < bodyTop + 90) v = 40 + bodyContrast;
      for (const p of plates) {
        const cover = Math.max(0, Math.min(1, 10.5 - Math.hypot(x - p.cx, y - p.cy)));
        v = v * (1 - cover) + (40 + plateContrast) * cover;
      }
      v += rand() * noise;
      data[y * W + x] = Math.max(0, Math.min(255, v));
    }
  }
  return { width: W, height: H, data, t: frame / FPS };
}

/** One snatch, t from lift-off: a 1,0 s pull to 90 rows up, 0,3 s
 *  overhead, a 0,4 s drop, then rest. */
function snatchBarRow(t: number, restRow = 140, top = 50): number {
  if (t < 0) return restRow;
  if (t < 1.0) return restRow - ((restRow - top) * (1 - Math.cos(Math.PI * t))) / 2;
  if (t < 1.3) return top;
  if (t < 1.7) return top + ((restRow - top) * (t - 1.3)) / 0.4;
  return restRow;
}

function snatchBodyTop(t: number): number {
  if (t < 0) return 60;
  if (t < 1.0) return 60 - 15 * t;
  if (t < 1.3) return 45 + (10 * (t - 1.0)) / 0.3;
  if (t < 1.7) return 55 - (10 * (t - 1.3)) / 0.4;
  if (t < 2.2) return 45 + (15 * (t - 1.7)) / 0.5;
  return 60;
}

/** A clip of `seconds`, with lifts starting at each of `liftOffs`. */
function clip(
  seconds: number,
  liftOffs: number[],
  overrides: Partial<Scene> & { barRowAt?: (t: number) => number } = {},
): Thumb[] {
  const out: Thumb[] = [];
  for (let frame = 0; frame < seconds * FPS; frame++) {
    const t = frame / FPS;
    const since = liftOffs.map(l => t - l).filter(d => d >= 0).sort((a, b) => a - b)[0] ?? -1;
    const barRow = overrides.barRowAt ? overrides.barRowAt(since) : snatchBarRow(since);
    out.push(renderThumb({ barRow, bodyTop: snatchBodyTop(since), ...overrides }, frame));
  }
  return out;
}

function windowsOf(thumbs: Thumb[]): { samples: ActivitySample[]; windows: LiftWindow[] } {
  const samples = activityOf(thumbs);
  return { samples, windows: liftWindows(samples, H) };
}

describe('activityOf', () => {
  it('lines samples up with thumbnails, the first with no motion', () => {
    const thumbs = clip(1, []);
    const samples = activityOf(thumbs);
    expect(samples).toHaveLength(thumbs.length);
    expect(samples[0].energy).toBe(0);
    expect(Number.isNaN(samples[0].centroidRow)).toBe(true);
    expect(samples[5].t).toBe(thumbs[5].t);
  });

  it('the accumulator gives the same samples one thumbnail at a time', () => {
    const thumbs = clip(2, [0.5]);
    const acc = activityAccumulator();
    for (const thumb of thumbs) acc.push(thumb);
    expect(acc.samples).toEqual(activityOf(thumbs));
  });

  it('averages sensor noise down to a fraction of a level', () => {
    const samples = activityOf(clip(1, []));
    const quiet = samples.slice(1).map(s => s.energy);
    expect(Math.max(...quiet)).toBeLessThan(0.6);
    expect(Math.max(...samples.map(s => s.coverage))).toBeLessThan(0.1);
  });

  it('puts the motion centroid on what moved', () => {
    // The bar rises from row 140 to 50 while the body barely moves: the
    // centroid follows the plates up.
    const samples = activityOf(clip(2.5, [0.5]));
    const early = samples[Math.round(0.6 * FPS)].centroidRow; // early in the pull, plates low
    const late = samples[Math.round(1.4 * FPS)].centroidRow; // near the top
    expect(early).toBeGreaterThan(100);
    expect(late).toBeLessThan(80);
  });
});

describe('liftWindows', () => {
  it('finds nothing in still frames with sensor noise', () => {
    const { windows } = windowsOf(clip(4, []));
    expect(windows).toEqual([]);
  });

  it('finds nothing in a fidget — the bar rolled a pixel, the lifter shuffling', () => {
    const thumbs: Thumb[] = [];
    for (let frame = 0; frame < 4 * FPS; frame++) {
      const t = frame / FPS;
      thumbs.push(
        renderThumb(
          { barRow: 140 + Math.sin(2 * Math.PI * t), bodyTop: 60 + 0.5 * Math.sin(2 * Math.PI * t * 1.3) },
          frame,
        ),
      );
    }
    const { windows } = windowsOf(thumbs);
    expect(windows).toEqual([]);
  });

  it('rejects a camera pan on coverage, whatever its energy', () => {
    const thumbs: Thumb[] = [];
    for (let frame = 0; frame < 4 * FPS; frame++) {
      const t = frame / FPS;
      // Still for a second, then the camera swings a pixel a frame for
      // 1,5 s, then still again.
      const panX = t < 1 ? 0 : t < 2.5 ? (t - 1) * FPS : 1.5 * FPS;
      thumbs.push(renderThumb({ barRow: 140, bodyTop: 60, panX }, frame));
    }
    const samples = activityOf(thumbs);
    const during = samples.slice(Math.round(1.2 * FPS), Math.round(2.3 * FPS));
    // The pan is emphatically active…
    expect(Math.min(...during.map(s => s.energy))).toBeGreaterThan(1);
    // …and changes most of the picture, which is what rejects it.
    const coverages = during.map(s => s.coverage).sort((a, b) => a - b);
    expect(coverages[coverages.length >> 1]).toBeGreaterThan(DEFAULT_LIFT_WINDOW_OPTIONS.coverageMax);
    expect(liftWindows(samples, H)).toEqual([]);
  });

  it('finds a snatch and anchors in the rest before it', () => {
    const liftOff = 2.0;
    const { windows } = windowsOf(clip(5, [liftOff]));
    expect(windows).toHaveLength(1);
    const [w] = windows;
    // The rest frame sits in the lead-in: just before the bar moves.
    expect(w.restT).toBeGreaterThanOrEqual(liftOff - DEFAULT_LIFT_WINDOW_OPTIONS.restLeadS - 0.05);
    expect(w.restT).toBeLessThanOrEqual(liftOff + 0.1);
    expect(w.fromT).toBeLessThanOrEqual(w.restT);
    // The window covers the whole lift, overhead position included.
    expect(w.toT).toBeGreaterThanOrEqual(liftOff + 1.3);
    expect(w.toT).toBeLessThanOrEqual(liftOff + DEFAULT_LIFT_WINDOW_OPTIONS.forwardCapS);
    expect(w.confidence).toBeGreaterThan(0.5);
    expect(w.evidence.centroidRiseRows).toBeGreaterThan(0.04 * H);
    expect(w.evidence.coverage).toBeLessThan(0.3);
    expect(w.evidence.peakEnergy).toBeGreaterThan(2 * w.evidence.quietEnergy);
  });

  it('cuts a double into two windows, each with its own rest', () => {
    const first = 1.5;
    const second = 5.5;
    const { windows } = windowsOf(clip(9, [first, second]));
    expect(windows).toHaveLength(2);
    expect(windows[0].restT).toBeLessThanOrEqual(first + 0.1);
    expect(windows[0].restT).toBeGreaterThan(first - 0.6);
    expect(windows[0].toT).toBeLessThan(second - 0.6);
    expect(windows[1].restT).toBeLessThanOrEqual(second + 0.1);
    expect(windows[1].restT).toBeGreaterThan(second - 0.6);
    // Disjoint, in order.
    expect(windows[1].fromT).toBeGreaterThanOrEqual(windows[0].toT);
  });

  it('still finds a lift whose bar leaves the top of the frame', () => {
    const liftOff = 2.0;
    const thumbs = clip(5, [liftOff], {
      barRowAt: t => snatchBarRow(t, 140, -20),
    });
    const { windows } = windowsOf(thumbs);
    expect(windows).toHaveLength(1);
    expect(windows[0].restT).toBeLessThanOrEqual(liftOff + 0.1);
    expect(windows[0].restT).toBeGreaterThan(liftOff - 0.6);
  });

  it('still finds a slow, low-contrast lift — recall over precision', () => {
    // Plates at 50 levels against the ground instead of 120, a body at
    // 30, a good camera (±1 level of noise), and a 60-row pull that takes
    // 1,4 s: about 1,5 rows a frame, a heavy first pull all the way up.
    const liftOff = 2.0;
    const thumbs = clip(5, [liftOff], {
      plateContrast: 50,
      bodyContrast: 30,
      noise: 2,
      barRowAt: t => {
        if (t < 0) return 140;
        if (t < 1.4) return 140 - (60 * t) / 1.4;
        if (t < 1.8) return 80;
        if (t < 2.2) return 80 + (60 * (t - 1.8)) / 0.4;
        return 140;
      },
    });
    const { windows } = windowsOf(thumbs);
    expect(windows).toHaveLength(1);
    expect(windows[0].restT).toBeLessThanOrEqual(liftOff + 0.1);
    expect(windows[0].toT).toBeGreaterThanOrEqual(liftOff + 1.4);
  });

  it('finds a lift in a clip that is nothing but the lift, from its first frame', () => {
    // A frame or two of rest and then the pull: the clip's "quiet" level
    // is the slow start of the pull, and the second pull still stands
    // out from it. The window starts where the clip does.
    const thumbs = clip(1.2, [0.05]);
    const windows = liftWindows(activityOf(thumbs), H);
    expect(windows).toHaveLength(1);
    expect(windows[0].restT).toBe(0);
    expect(windows[0].toT).toBeGreaterThan(0.9);
  });
});

describe('windowRanges', () => {
  const timestamps = Array.from({ length: 100 }, (_, i) => i / FPS);
  const evidence = {
    peakEnergy: 3,
    quietEnergy: 0.2,
    centroidRiseRows: 30,
    centroidFallRows: 20,
    coverage: 0.1,
    burstS: 1.5,
  };

  it('maps by nearest timestamp and keeps the rest inside the range', () => {
    const [range] = windowRanges(
      [{ restT: 0.51, fromT: 0.5, toT: 2.0, confidence: 0.8, evidence }],
      timestamps,
    );
    expect(range.from).toBe(15);
    expect(range.restIndex).toBe(15);
    expect(range.to).toBe(60);
  });

  it('clamps to the clip', () => {
    const [range] = windowRanges(
      [{ restT: -1, fromT: -1, toT: 10, confidence: 0.8, evidence }],
      timestamps,
    );
    expect(range).toEqual({ restIndex: 0, from: 0, to: 99 });
  });
});
