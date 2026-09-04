/**
 * The load–velocity line, tested against data built from a known line, and
 * against the shapes of data a real training week produces: too few reps,
 * too narrow a load range, a session where nothing varied but the technique.
 */
import { describe, expect, it } from 'vitest';
import {
  estimateOneRepMax,
  extrapolation,
  fitLoadVelocityProfile,
  loadForVelocity,
  repAtLossCutoff,
  thresholdFrom,
  velocityAtLoad,
  velocityLoss,
  type LoadVelocityPoint,
} from '../loadVelocity';

/** v = 2,60 − 0,0090·load: 1,70 m/s at 100 kg, and a 1RM of 122 kg if the
 *  athlete's maximum moves at 1,50 m/s. */
const TRUE_INTERCEPT = 2.6;
const TRUE_SLOPE = -0.009;

function sweep(loads: number[], noise = 0): LoadVelocityPoint[] {
  let seed = 11;
  const jitter = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return (seed / 2147483648 - 0.5) * 2 * noise;
  };
  return loads.map(loadKg => ({
    loadKg,
    velocityMs: TRUE_INTERCEPT + TRUE_SLOPE * loadKg + jitter(),
    grade: 'B' as const,
  }));
}

describe('fitLoadVelocityProfile', () => {
  it('recovers the line the reps were built from', () => {
    const profile = fitLoadVelocityProfile(sweep([70, 80, 90, 100, 110]))!;
    expect(profile.interceptMs).toBeCloseTo(TRUE_INTERCEPT, 6);
    expect(profile.slopeMsPerKg).toBeCloseTo(TRUE_SLOPE, 6);
    expect(profile.r2).toBeCloseTo(1, 6);
    expect(profile.n).toBe(5);
    expect(profile.minLoadKg).toBe(70);
    expect(profile.maxLoadKg).toBe(110);
  });

  it('survives realistic scatter and reports it', () => {
    const profile = fitLoadVelocityProfile(sweep([60, 70, 80, 90, 100, 110], 0.06))!;
    expect(profile.slopeMsPerKg).toBeCloseTo(TRUE_SLOPE, 3);
    expect(profile.residualMs).toBeGreaterThan(0);
    expect(profile.residualMs).toBeLessThan(0.06);
    expect(profile.r2).toBeGreaterThan(0.9);
  });

  it('refuses a session that never varied the load', () => {
    // Five reps at 80–85 kg fit a beautiful line that predicts nothing.
    expect(fitLoadVelocityProfile(sweep([80, 81, 82, 84, 85]))).toBeNull();
  });

  it('refuses too few reps', () => {
    expect(fitLoadVelocityProfile(sweep([70, 100]))).toBeNull();
  });

  it('refuses when velocity does not fall with load', () => {
    // Whatever separates these reps, it is not the load.
    const points: LoadVelocityPoint[] = [
      { loadKg: 70, velocityMs: 1.6 },
      { loadKg: 85, velocityMs: 1.7 },
      { loadKg: 100, velocityMs: 1.75 },
      { loadKg: 115, velocityMs: 1.9 },
    ];
    expect(fitLoadVelocityProfile(points)).toBeNull();
  });

  it('leaves C-graded reps out by default and can be told not to', () => {
    const points = [
      ...sweep([70, 85, 100, 115]),
      { loadKg: 90, velocityMs: 0.2, grade: 'C' as const },
    ];
    expect(fitLoadVelocityProfile(points)!.n).toBe(4);
    expect(fitLoadVelocityProfile(points, { excludeWeakGrades: false })!.n).toBe(5);
  });
});

describe('reading the profile', () => {
  const profile = fitLoadVelocityProfile(sweep([70, 80, 90, 100, 110]))!;

  it('goes both ways consistently', () => {
    expect(velocityAtLoad(profile, 100)).toBeCloseTo(1.7, 6);
    expect(loadForVelocity(profile, 1.7)).toBeCloseTo(100, 6);
  });

  it('says how far outside the measured loads a prediction sits', () => {
    expect(extrapolation(profile, 90)).toBe(0);
    expect(extrapolation(profile, 110)).toBe(0);
    // A whole fitted range beyond the heaviest rep.
    expect(extrapolation(profile, 150)).toBeCloseTo(1, 6);
    expect(extrapolation(profile, 50)).toBeCloseTo(0.5, 6);
  });
});

describe('estimateOneRepMax', () => {
  const profile = fitLoadVelocityProfile(sweep([70, 80, 90, 100, 110]))!;

  it('reads the maximum at the velocity the maximum moves', () => {
    const estimate = estimateOneRepMax(profile, { velocityMs: 1.5, source: 'measured' });
    expect(estimate.loadKg).toBeCloseTo(122.2, 1);
    expect(estimate.thresholdSource).toBe('measured');
  });

  it('carries how far it extrapolated, so the number cannot pose as a test', () => {
    // A threshold well below anything lifted extends the line a long way.
    const wild = estimateOneRepMax(profile, { velocityMs: 0.8, source: 'assumed' });
    expect(wild.loadKg).toBeGreaterThan(profile.maxLoadKg);
    expect(wild.extrapolation).toBeGreaterThan(1);
    expect(wild.thresholdSource).toBe('assumed');
  });
});

describe('thresholdFrom', () => {
  it('takes the slowest of the near-maximal reps', () => {
    const points: LoadVelocityPoint[] = [
      { loadKg: 80, velocityMs: 1.9 },
      { loadKg: 118, velocityMs: 1.55 },
      { loadKg: 120, velocityMs: 1.48 },
    ];
    expect(thresholdFrom(points)!.velocityMs).toBeCloseTo(1.48, 6);
    expect(thresholdFrom(points)!.source).toBe('measured');
  });

  it('is null when nothing was heavy', () => {
    expect(thresholdFrom([])).toBeNull();
  });
});

describe('velocityLoss', () => {
  it('measures from the best rep, not the first', () => {
    // The second rep is faster than the first, as it routinely is.
    const loss = velocityLoss([1.6, 1.7, 1.62, 1.5])!;
    expect(loss.bestIndex).toBe(1);
    expect(loss.bestMs).toBeCloseTo(1.7, 6);
    expect(loss.lastMs).toBeCloseTo(1.5, 6);
    expect(loss.lossPct).toBeCloseTo(11.76, 1);
    expect(loss.reps).toBe(4);
  });

  it('reports the worst drop as well as the last', () => {
    // The lifter rallied on the final rep; the set still fell 20 % at its
    // lowest, and that is what fatigue did.
    const loss = velocityLoss([1.7, 1.36, 1.6])!;
    expect(loss.lossPct).toBeCloseTo(5.88, 1);
    expect(loss.worstLossPct).toBeCloseTo(20, 1);
  });

  it('needs at least two reps', () => {
    expect(velocityLoss([1.7])).toBeNull();
    expect(velocityLoss([])).toBeNull();
  });
});

describe('repAtLossCutoff', () => {
  it('names the rep a cutoff would have stopped on', () => {
    expect(repAtLossCutoff([1.7, 1.65, 1.6, 1.5], 10)).toBe(4);
    expect(repAtLossCutoff([1.7, 1.65, 1.6, 1.5], 5)).toBe(3);
  });

  it('is null for a set that never slowed that far', () => {
    expect(repAtLossCutoff([1.7, 1.69, 1.68], 10)).toBeNull();
  });
});
