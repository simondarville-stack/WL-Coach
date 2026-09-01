/**
 * The quality grade.
 *
 * The most important test in this file is the first one: the error budget is
 * derived from first principles, not fitted, and it has to reproduce the two
 * accuracy tiers the product promises (design §6.4) without being told them.
 * If that stops holding, either the model or the promise is wrong and both are
 * worth revisiting.
 */
import { describe, expect, it } from 'vitest';
import { calibrateFromEllipse, type PlateEllipse } from '../calibration';
import { DEFAULT_FILTER } from '../signal';
import {
  GRADE_A_MAX_ERROR_MS,
  GRADE_B_MAX_ERROR_MS,
  effectiveTier,
  estimateVelocityErrorMs,
  gradeAnalysis,
  type GradeInputs,
} from '../grade';

/** A plate 225 px across for 45 cm ⇒ 0,2 cm/px ⇒ 2 mm/px, the resolution the
 *  design doc uses as its worked example. */
const twoMmPerPx: PlateEllipse = {
  cx: 500,
  cy: 400,
  semiMajorPx: 112.5,
  semiMinorPx: 112.5,
  tiltDeg: 0,
};
const cal = calibrateFromEllipse(twoMmPerPx, 45);

function inputs(overrides: Partial<GradeInputs> = {}): GradeInputs {
  return {
    sampleRateHz: 60,
    vfr: false,
    calibration: cal,
    filtered: true,
    filter: DEFAULT_FILTER,
    trackerTier: 'manual',
    correctionCount: 0,
    trackedFrames: 100,
    camera: 'tripod',
    distortionSource: 'profile',
    ...overrides,
  };
}

describe('the error budget reproduces the promised tiers', () => {
  it('everyday: a hand-marked 60 fps clip at 2 mm/px lands on ±0,05 m/s', () => {
    // σ_pos = 1,5 px × 0,2 cm/px / 100 = 0,003 m; √(60 × 6) = 19,0
    // ⇒ 0,057 m/s, before any multiplier. The design doc's everyday tier.
    const error = estimateVelocityErrorMs(inputs())!;
    expect(error).toBeGreaterThan(0.04);
    expect(error).toBeLessThan(0.07);
  });

  it('hardcore: the same clip with a marker lands on ±0,02 m/s', () => {
    const error = estimateVelocityErrorMs(inputs({ trackerTier: 'marker' }))!;
    expect(error).toBeGreaterThan(0.01);
    expect(error).toBeLessThan(0.025);
  });
});

describe('estimateVelocityErrorMs — what moves it', () => {
  it('halving the millimetres per pixel halves the error', () => {
    const finer = calibrateFromEllipse({ ...twoMmPerPx, semiMajorPx: 225, semiMinorPx: 225 }, 45);
    const a = estimateVelocityErrorMs(inputs())!;
    const b = estimateVelocityErrorMs(inputs({ calibration: finer }))!;
    expect(b / a).toBeCloseTo(0.5, 2);
  });

  it('a HIGHER frame rate makes velocity noisier, not cleaner', () => {
    // The counter-intuitive one, and the reason the model is worth having:
    // shorter differentiation intervals amplify the same pixel noise more.
    // Frame rate buys temporal resolution, not precision.
    const slow = estimateVelocityErrorMs(inputs({ sampleRateHz: 60 }))!;
    const fast = estimateVelocityErrorMs(inputs({ sampleRateHz: 240 }))!;
    expect(fast).toBeGreaterThan(slow);
    expect(fast / slow).toBeCloseTo(2, 1);
  });

  it('a lower cutoff cleans the velocity up', () => {
    const wide = estimateVelocityErrorMs(inputs())!;
    const narrow = estimateVelocityErrorMs(
      inputs({ filter: { ...DEFAULT_FILTER, cutoffHz: 3 } }),
    )!;
    expect(narrow).toBeLessThan(wide);
  });

  it('an unsmoothed series is far worse than a smoothed one', () => {
    const smoothed = estimateVelocityErrorMs(inputs())!;
    const raw = estimateVelocityErrorMs(inputs({ filtered: false }))!;
    expect(raw).toBeGreaterThan(smoothed * 2);
  });

  it('handheld costs more than a tripod', () => {
    expect(estimateVelocityErrorMs(inputs({ camera: 'handheld' }))!).toBeGreaterThan(
      estimateVelocityErrorMs(inputs({ camera: 'tripod' }))!,
    );
  });

  it('an off-perpendicular view costs, and costs more the further off it is', () => {
    const at30 = calibrateFromEllipse(
      { ...twoMmPerPx, semiMinorPx: 112.5 * Math.cos(Math.PI / 6) },
      45,
    );
    const at60 = calibrateFromEllipse({ ...twoMmPerPx, semiMinorPx: 112.5 * 0.5 }, 45);
    const square = estimateVelocityErrorMs(inputs())!;
    const oblique = estimateVelocityErrorMs(inputs({ calibration: at30 }))!;
    const worse = estimateVelocityErrorMs(inputs({ calibration: at60 }))!;
    expect(oblique).toBeGreaterThan(square);
    expect(worse).toBeGreaterThan(oblique);
  });

  it('variable frame rate costs a little', () => {
    expect(estimateVelocityErrorMs(inputs({ vfr: true }))!).toBeGreaterThan(
      estimateVelocityErrorMs(inputs({ vfr: false }))!,
    );
  });

  it('is null without a usable calibration', () => {
    expect(estimateVelocityErrorMs(inputs({ calibration: null }))).toBeNull();
    const degenerate = calibrateFromEllipse({ ...twoMmPerPx, semiMajorPx: 3, semiMinorPx: 3 }, 45);
    expect(estimateVelocityErrorMs(inputs({ calibration: degenerate }))).toBeNull();
  });
});

describe('effectiveTier', () => {
  it('leaves a lightly-corrected assisted track alone', () => {
    expect(effectiveTier('assisted', 5, 100)).toBe('assisted');
  });

  it('demotes a track the coach had to fix constantly', () => {
    // An assisted track corrected on half its frames is a hand-marked track
    // with extra steps.
    expect(effectiveTier('assisted', 50, 100)).toBe('manual');
  });

  it('cannot demote a manual track below itself', () => {
    expect(effectiveTier('manual', 90, 100)).toBe('manual');
  });
});

describe('gradeAnalysis', () => {
  it('gives A to the serious tier', () => {
    const result = gradeAnalysis(inputs({ trackerTier: 'marker' }));
    expect(result.grade).toBe('A');
    expect(result.expectedVelocityErrorMs!).toBeLessThanOrEqual(GRADE_A_MAX_ERROR_MS);
    expect(result.summary).toMatch(/1,80/);
  });

  it('gives B to everyday hand-marked footage', () => {
    const result = gradeAnalysis(inputs());
    expect(result.grade).toBe('B');
    expect(result.expectedVelocityErrorMs!).toBeLessThanOrEqual(GRADE_B_MAX_ERROR_MS);
  });

  it('gives C to a coarse handheld clip', () => {
    const coarse = calibrateFromEllipse({ ...twoMmPerPx, semiMajorPx: 30, semiMinorPx: 30 }, 45);
    const result = gradeAnalysis(
      inputs({ calibration: coarse, camera: 'handheld', distortionSource: 'none' }),
    );
    expect(result.grade).toBe('C');
  });

  it('caps an unsmoothed analysis at C however good the rest is', () => {
    const result = gradeAnalysis(inputs({ trackerTier: 'marker', filtered: false }));
    expect(result.grade).toBe('C');
    expect(result.summary).toMatch(/unsmoothed/);
  });

  it('caps a wide-angle calibration at B however good the rest is', () => {
    const wide = calibrateFromEllipse({ ...twoMmPerPx, semiMinorPx: 112.5 * 0.6 }, 45);
    expect(wide.confidence).toBe('wide');
    const result = gradeAnalysis(inputs({ calibration: wide, trackerTier: 'marker' }));
    expect(result.grade).toBe('B');
  });

  it('refuses to grade an uncalibrated analysis at all', () => {
    const result = gradeAnalysis(inputs({ calibration: null }));
    expect(result.grade).toBeNull();
    expect(result.expectedVelocityErrorMs).toBeNull();
    expect(result.summary).toMatch(/no scale/i);
    expect(result.improvements[0]).toMatch(/Outline a plate/);
  });

  it('names every condition, with a verdict in words as well as a colour', () => {
    const result = gradeAnalysis(inputs());
    const ids = result.factors.map(f => f.id);
    expect(ids).toContain('scale');
    expect(ids).toContain('resolution');
    expect(ids).toContain('rate');
    expect(ids).toContain('tracking');
    expect(ids).toContain('filter');
    expect(ids).toContain('camera');
    expect(ids).toContain('lens');
    expect(ids).toContain('estimate');
    for (const factor of result.factors) {
      expect(['good', 'fair', 'weak']).toContain(factor.verdict);
      expect(factor.why.length).toBeGreaterThan(20);
    }
  });

  it('says a heavily-corrected assisted track is being read as hand-marked', () => {
    const result = gradeAnalysis(
      inputs({ trackerTier: 'assisted', correctionCount: 40, trackedFrames: 100 }),
    );
    expect(result.factors.find(f => f.id === 'tracking')!.value).toMatch(/heavily corrected/i);
  });

  it('tells the coach what would actually help, biggest term first', () => {
    const coarse = calibrateFromEllipse({ ...twoMmPerPx, semiMajorPx: 30, semiMinorPx: 30 }, 45);
    const result = gradeAnalysis(inputs({ calibration: coarse, camera: 'handheld' }));
    expect(result.improvements[0]).toMatch(/closer|resolution/i);
  });

  it('has little left to suggest at grade A', () => {
    const result = gradeAnalysis(inputs({ trackerTier: 'marker' }));
    expect(result.improvements.length).toBeLessThanOrEqual(1);
  });
});
