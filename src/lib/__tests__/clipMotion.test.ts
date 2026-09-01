import { describe, expect, it } from 'vitest';
import {
  suggestTrimFromMotion,
  TRIM_MIN_SECONDS,
  TRIM_PAD_AFTER,
  TRIM_PAD_BEFORE,
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
}: {
  duration: number;
  rate?: number;
  baseline?: number;
  peak?: number;
  burst?: [number, number];
}): MotionSample[] {
  const samples: MotionSample[] = [];
  for (let t = 0; t < duration; t += 1 / rate) {
    const inBurst = burst != null && t >= burst[0] && t < burst[1];
    samples.push({ t, energy: inBurst ? peak : baseline });
  }
  return samples;
}

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
