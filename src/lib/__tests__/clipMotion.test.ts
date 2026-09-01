import { describe, expect, it } from 'vitest';
import {
  compareFrames,
  findLifts,
  suggestTrimFromMotion,
  TRIM_MIN_SECONDS,
  TRIM_PAD_AFTER,
  TRIM_PAD_BEFORE,
  weightedEnergy,
  type MotionSample,
} from '../clipMotion';

/**
 * Build a motion signal at `rate` Hz: a `baseline` of ambient movement with a
 * burst of `peak` energy over [burstStart, burstEnd) — the shape of an athlete
 * milling about the platform and then lifting.
 */
function signal({
  duration,
  rate = 4,
  baseline = 0.02,
  peak = 0.3,
  burst,
  bursts,
}: {
  duration: number;
  rate?: number;
  baseline?: number;
  peak?: number;
  burst?: [number, number];
  bursts?: [number, number][];
}): MotionSample[] {
  const all = bursts ?? (burst ? [burst] : []);
  const samples: MotionSample[] = [];
  for (let t = 0; t < duration; t += 1 / rate) {
    const inBurst = all.some(([from, to]) => t >= from && t < to);
    samples.push({ t, energy: inBurst ? peak : baseline });
  }
  return samples;
}

/** A width×height luma frame with a filled rectangle on a flat background —
 *  enough of a "barbell" for block matching to have something to track. */
function frame(width: number, height: number, box: { x: number; y: number; size: number }) {
  const px = new Uint8ClampedArray(width * height).fill(40);
  for (let y = box.y; y < box.y + box.size; y++) {
    for (let x = box.x; x < box.x + box.size; x++) {
      if (x >= 0 && x < width && y >= 0 && y < height) px[y * width + x] = 230;
    }
  }
  return px;
}

describe('weightedEnergy', () => {
  it('treats an absent verticality as no opinion', () => {
    expect(weightedEnergy({ t: 0, energy: 0.2 })).toBeCloseTo(0.2);
    expect(weightedEnergy({ t: 0, energy: 0.2, verticality: 0.5 })).toBeCloseTo(0.2);
  });

  it('promotes vertical motion over horizontal', () => {
    const vertical = weightedEnergy({ t: 0, energy: 0.2, verticality: 1 });
    const horizontal = weightedEnergy({ t: 0, energy: 0.2, verticality: 0 });
    expect(vertical).toBeGreaterThan(0.2);
    expect(horizontal).toBeLessThan(0.2);
  });

  it('lets a vertical burst beat a larger horizontal one', () => {
    // The point of the weighting: a coach crossing the frame moves more
    // pixels than a barbell, and must still lose to it.
    const barbell = weightedEnergy({ t: 0, energy: 0.20, verticality: 0.95 });
    const passerby = weightedEnergy({ t: 0, energy: 0.26, verticality: 0.05 });
    expect(barbell).toBeGreaterThan(passerby);
  });
});

describe('compareFrames', () => {
  const W = 48;
  const H = 48;
  const start = { x: 20, y: 20, size: 6 };

  it('scores a box moving up as vertical', () => {
    const a = frame(W, H, start);
    const b = frame(W, H, { ...start, y: start.y - 2 });
    expect(compareFrames(b, a, W, H).verticality).toBeGreaterThan(0.7);
  });

  it('scores a box moving sideways as horizontal', () => {
    const a = frame(W, H, start);
    const b = frame(W, H, { ...start, x: start.x - 2 });
    expect(compareFrames(b, a, W, H).verticality).toBeLessThan(0.3);
  });

  it('reports energy regardless of direction', () => {
    const a = frame(W, H, start);
    const up = compareFrames(frame(W, H, { ...start, y: start.y - 2 }), a, W, H);
    const across = compareFrames(frame(W, H, { ...start, x: start.x - 2 }), a, W, H);
    expect(up.energy).toBeGreaterThan(0);
    expect(up.energy).toBeCloseTo(across.energy, 2);
  });

  it('has no opinion on a still frame', () => {
    const a = frame(W, H, start);
    const result = compareFrames(a, a, W, H);
    expect(result.energy).toBe(0);
    expect(result.verticality).toBe(0.5);
  });
});

describe('findLifts', () => {
  it('finds each lift in a set of singles filmed in one take', () => {
    const lifts = findLifts(
      signal({ duration: 120, bursts: [[20, 24], [55, 59], [90, 94]] }),
      { duration: 120 },
    );

    expect(lifts).toHaveLength(3);
    expect(lifts.map(l => Math.round(l.start))).toEqual([19, 54, 89]);
    // In time order, and never overlapping — each becomes its own clip.
    for (let i = 1; i < lifts.length; i++) {
      expect(lifts[i].start).toBeGreaterThanOrEqual(lifts[i - 1].end);
    }
  });

  it('merges lifts too close together to be separate clips', () => {
    // Two seconds apart: after run-out and run-up they would overlap, and two
    // clips repeating each other's footage helps nobody.
    const lifts = findLifts(signal({ duration: 60, bursts: [[20, 22], [24, 26]] }), {
      duration: 60,
    });

    expect(lifts).toHaveLength(1);
    expect(lifts[0].start).toBeLessThan(20);
    expect(lifts[0].end).toBeGreaterThan(26);
  });

  it('ignores a wobble beside a real lift', () => {
    const samples = signal({ duration: 60, burst: [30, 34] });
    for (const s of samples) if (s.t >= 10 && s.t < 11) s.energy = 0.06;

    const lifts = findLifts(samples, { duration: 60 });
    expect(lifts).toHaveLength(1);
    expect(lifts[0].start).toBeGreaterThan(11);
  });

  it('caps a pathological clip rather than emitting dozens of clips', () => {
    const bursts: [number, number][] = [];
    for (let i = 0; i < 20; i++) bursts.push([i * 10, i * 10 + 2]);
    const lifts = findLifts(signal({ duration: 200, bursts }), { duration: 200 });

    expect(lifts.length).toBeLessThanOrEqual(6);
    expect(lifts).toEqual([...lifts].sort((a, b) => a.start - b.start));
  });

  it('returns nothing when there is no clear burst', () => {
    expect(findLifts(signal({ duration: 60 }), { duration: 60 })).toEqual([]);
  });

  it('applies the duration cap to every lift it returns', () => {
    const lifts = findLifts(
      signal({ duration: 300, bursts: [[20, 80], [150, 210]] }),
      { duration: 300, maxSeconds: 60 },
    );

    expect(lifts.length).toBeGreaterThan(0);
    for (const lift of lifts) expect(lift.end - lift.start).toBeLessThanOrEqual(60 + 1e-9);
  });

  it('prefers the vertical burst when two compete', () => {
    // A passer-by moving more pixels than the lift, which is exactly the case
    // the weighting exists for.
    const samples = signal({ duration: 90, bursts: [[20, 24], [60, 64]] });
    for (const s of samples) {
      if (s.t >= 20 && s.t < 24) { s.energy = 0.20; s.verticality = 0.95; }
      if (s.t >= 60 && s.t < 64) { s.energy = 0.26; s.verticality = 0.05; }
    }

    const best = suggestTrimFromMotion(samples, { duration: 90 });
    expect(best).not.toBeNull();
    expect(best!.start).toBeLessThan(24);
  });
});

describe('suggestTrimFromMotion', () => {
  it('brackets a burst with run-up and run-out', () => {
    const s = suggestTrimFromMotion(signal({ duration: 60, burst: [30, 34] }), { duration: 60 });

    expect(s).not.toBeNull();
    expect(s!.start).toBeCloseTo(30 - TRIM_PAD_BEFORE, 1);
    // The last hot sample sits just under 34 s, plus the run-out.
    expect(s!.end).toBeGreaterThan(34);
    expect(s!.end).toBeLessThanOrEqual(34 + TRIM_PAD_AFTER + 0.5);
  });

  it('declines a clip with no peak to speak of', () => {
    // Uniform motion: a pan, a busy gym, a camera on a shaky tripod. There is
    // no "the lift" here and guessing one would be worse than saying nothing.
    expect(suggestTrimFromMotion(signal({ duration: 60 }), { duration: 60 })).toBeNull();
  });

  it('declines when the burst covers the whole clip', () => {
    // Nothing would be saved, so there is nothing to suggest.
    expect(
      suggestTrimFromMotion(signal({ duration: 20, burst: [0, 20] }), { duration: 20 }),
    ).toBeNull();
  });

  it('declines a signal too short to read', () => {
    expect(
      suggestTrimFromMotion(signal({ duration: 1, rate: 4, burst: [0, 0.5] }), { duration: 1 }),
    ).toBeNull();
  });

  it('clamps a burst at the very start of the clip', () => {
    const s = suggestTrimFromMotion(signal({ duration: 40, burst: [0, 3] }), { duration: 40 });

    expect(s).not.toBeNull();
    expect(s!.start).toBe(0);
    expect(s!.end).toBeLessThan(40);
  });

  it('clamps a burst at the very end of the clip', () => {
    const s = suggestTrimFromMotion(signal({ duration: 40, burst: [37, 40] }), { duration: 40 });

    expect(s).not.toBeNull();
    expect(s!.end).toBe(40);
    expect(s!.start).toBeGreaterThan(0);
  });

  it('never suggests a window shorter than the minimum', () => {
    // A single hot sample: real, but two seconds of footage is not a review.
    const s = suggestTrimFromMotion(signal({ duration: 40, burst: [20, 20.3] }), {
      duration: 40,
      padBefore: 0,
      padAfter: 0,
    });

    expect(s).not.toBeNull();
    expect(s!.end - s!.start).toBeGreaterThanOrEqual(TRIM_MIN_SECONDS - 1e-9);
  });

  it('honours a duration cap, keeping the lift rather than the run-up', () => {
    const s = suggestTrimFromMotion(signal({ duration: 300, burst: [100, 160] }), {
      duration: 300,
      maxSeconds: 60,
    });

    expect(s).not.toBeNull();
    expect(s!.end - s!.start).toBeLessThanOrEqual(60 + 1e-9);
    // The peak is the first hot sample here, and it stays inside the window.
    expect(s!.start).toBeLessThanOrEqual(100);
    expect(s!.end).toBeGreaterThan(100);
  });

  it('rides out a dip inside the lift instead of stopping at it', () => {
    // The float between the second pull and the catch reads quiet; cutting
    // there would drop the turnover off the end of the clip.
    const samples = signal({ duration: 40, rate: 4, burst: [20, 24] });
    const dip = samples.find(s => Math.abs(s.t - 22) < 0.01)!;
    dip.energy = 0.02;

    const s = suggestTrimFromMotion(samples, { duration: 40, padBefore: 0, padAfter: 0 });
    expect(s).not.toBeNull();
    expect(s!.start).toBeLessThanOrEqual(20);
    expect(s!.end).toBeGreaterThan(23);
  });

  it('returns the strongest lift when a clip holds several', () => {
    const samples = signal({ duration: 120, bursts: [[20, 24], [60, 64]] });
    for (const s of samples) if (s.t >= 60 && s.t < 64) s.energy = 0.5;

    const best = suggestTrimFromMotion(samples, { duration: 120 });
    expect(best!.start).toBeGreaterThan(55);
    expect(best!.start).toBeLessThan(60);
  });

  it('reports higher confidence for a cleaner peak', () => {
    const noisy = suggestTrimFromMotion(
      signal({ duration: 60, baseline: 0.1, peak: 0.2, burst: [30, 34] }),
      { duration: 60 },
    );
    const clean = suggestTrimFromMotion(
      signal({ duration: 60, baseline: 0.01, peak: 0.4, burst: [30, 34] }),
      { duration: 60 },
    );

    expect(clean!.confidence).toBeGreaterThan(noisy!.confidence);
  });

  it('keeps the suggestion inside the clip whatever the padding', () => {
    for (const burst of [[0, 2], [18, 20], [9, 11]] as [number, number][]) {
      const s = suggestTrimFromMotion(signal({ duration: 20, burst }), {
        duration: 20,
        padBefore: 10,
        padAfter: 10,
      });
      if (!s) continue;
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(20);
      expect(s.end).toBeGreaterThan(s.start);
    }
  });
});
