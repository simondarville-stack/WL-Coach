/**
 * The calibration engine. Every centimetre KinEMOS ever prints comes through
 * here, so this file is deliberately thorough — including the anisotropy,
 * which is the part a single-scale implementation gets quietly wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLATE_DIAMETER_CM,
  angleDeg,
  calibrateFromEllipse,
  displacementToCm,
  distanceCm,
  normaliseTilt,
  pathMetrics,
  type PlateEllipse,
} from '../calibration';

/** A plate seen dead-on: 100 px across for a 45 cm disc ⇒ 0,45 cm/px. */
const perpendicular: PlateEllipse = {
  cx: 400,
  cy: 300,
  semiMajorPx: 50,
  semiMinorPx: 50,
  tiltDeg: 0,
};

/** The same plate from 60° — cos 60° = 0,5, so the minor axis halves. */
const oblique: PlateEllipse = { ...perpendicular, semiMinorPx: 25 };

describe('calibrateFromEllipse', () => {
  it('reads the scale off the major axis', () => {
    const cal = calibrateFromEllipse(perpendicular);
    expect(cal.cmPerPxV).toBeCloseTo(0.45, 6);
    expect(cal.plateDiameterCm).toBe(DEFAULT_PLATE_DIAMETER_CM);
  });

  it('reports a perpendicular shot as isotropic and 0°', () => {
    const cal = calibrateFromEllipse(perpendicular);
    expect(cal.viewingAngleDeg).toBeCloseTo(0, 6);
    expect(cal.cmPerPxH).toBeCloseTo(cal.cmPerPxV, 6);
    expect(cal.confidence).toBe('ok');
  });

  it('recovers the viewing angle from the foreshortening', () => {
    const cal = calibrateFromEllipse(oblique);
    expect(cal.viewingAngleDeg).toBeCloseTo(60, 4);
  });

  it('scales horizontally by 1/cos θ, not by the vertical scale', () => {
    const cal = calibrateFromEllipse(oblique);
    // The single-scale bug would put these two numbers equal.
    expect(cal.cmPerPxH).toBeCloseTo(cal.cmPerPxV / Math.cos((60 * Math.PI) / 180), 6);
    expect(cal.cmPerPxH).toBeGreaterThan(cal.cmPerPxV);
  });

  it('honours a coach-set plate diameter', () => {
    const cal = calibrateFromEllipse(perpendicular, 22.8);
    expect(cal.cmPerPxV).toBeCloseTo(0.228, 6);
  });

  it('falls back to the default rather than dividing by a zero diameter', () => {
    expect(calibrateFromEllipse(perpendicular, 0).plateDiameterCm).toBe(DEFAULT_PLATE_DIAMETER_CM);
  });

  it('flags a shot past the models validity limit', () => {
    // 45° off perpendicular: still returned, but marked.
    const cal = calibrateFromEllipse({ ...perpendicular, semiMinorPx: 50 * Math.cos(Math.PI / 4) });
    expect(cal.confidence).toBe('wide');
    expect(cal.reason).toMatch(/off perpendicular/);
    expect(cal.cmPerPxV).toBeGreaterThan(0);
  });

  it('refuses to vouch for a plate a handful of pixels across', () => {
    const cal = calibrateFromEllipse({ ...perpendicular, semiMajorPx: 5, semiMinorPx: 5 });
    expect(cal.confidence).toBe('degenerate');
  });

  it('survives a zero-size outline instead of returning NaN scales', () => {
    const cal = calibrateFromEllipse({ ...perpendicular, semiMajorPx: 0, semiMinorPx: 0 });
    expect(cal.confidence).toBe('degenerate');
    expect(cal.cmPerPxV).toBe(0);
    expect(Number.isNaN(cal.cmPerPxH)).toBe(false);
  });

  it('takes the longer axis as major however the coach dragged the handles', () => {
    const dragged = calibrateFromEllipse({ ...perpendicular, semiMajorPx: 25, semiMinorPx: 50 });
    const canonical = calibrateFromEllipse(oblique);
    expect(dragged.cmPerPxV).toBeCloseTo(canonical.cmPerPxV, 6);
    expect(dragged.viewingAngleDeg).toBeCloseTo(60, 4);
    // Swapping the axes is a quarter turn of the frame.
    expect(dragged.tiltDeg).toBeCloseTo(90, 6);
  });
});

describe('normaliseTilt', () => {
  it('folds an over-rotated plate onto the equivalent small angle', () => {
    expect(normaliseTilt(100)).toBeCloseTo(-80, 6);
    expect(normaliseTilt(-170)).toBeCloseTo(10, 6);
    expect(normaliseTilt(3)).toBeCloseTo(3, 6);
  });
});

describe('displacementToCm', () => {
  const cal = calibrateFromEllipse(oblique); // V 0,45 · H 0,90 cm/px

  it('turns image-down into world-up', () => {
    // 100 px up the frame is -100 in image y.
    expect(displacementToCm(cal, 0, -100).y).toBeCloseTo(45, 6);
    expect(displacementToCm(cal, 0, 100).y).toBeCloseTo(-45, 6);
  });

  it('applies the wider horizontal scale across the frame', () => {
    expect(displacementToCm(cal, 100, 0).x).toBeCloseTo(90, 6);
  });

  it('decomposes onto the plates own axes when the camera is tilted', () => {
    const tilted = calibrateFromEllipse({ ...perpendicular, tiltDeg: 90 });
    // With the major axis lying along image x, a horizontal pixel run is now
    // the unforeshortened direction.
    expect(tilted.tiltDeg).toBeCloseTo(90, 6);
    expect(displacementToCm(tilted, 100, 0).y).toBeCloseTo(45, 6);
  });
});

describe('distanceCm', () => {
  const cal = calibrateFromEllipse(oblique);

  it('measures a pure rise with the vertical scale', () => {
    expect(distanceCm(cal, { x: 0, y: 200 }, { x: 0, y: 100 })).toBeCloseTo(45, 6);
  });

  it('does not measure a diagonal with the vertical scale alone', () => {
    const d = distanceCm(cal, { x: 0, y: 100 }, { x: 100, y: 0 });
    // The naive single-scale answer would be hypot(100,100)*0,45 = 63,6 cm.
    expect(d).toBeCloseTo(Math.hypot(90, 45), 6);
    expect(d).toBeGreaterThan(63.7);
  });
});

describe('angleDeg', () => {
  it('measures a right angle as 90° on a perpendicular shot', () => {
    const cal = calibrateFromEllipse(perpendicular);
    expect(angleDeg(cal, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 100 })).toBeCloseTo(90, 6);
  });

  it('corrects an angle read off a foreshortened frame', () => {
    const cal = calibrateFromEllipse(oblique);
    // A 45° arm as DRAWN is not 45° in the movement plane once the horizontal
    // axis is stretched by 2×.
    const drawn = angleDeg(null, { x: 100, y: -100 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    const real = angleDeg(cal, { x: 100, y: -100 }, { x: 0, y: 0 }, { x: 100, y: 0 });
    expect(drawn).toBeCloseTo(45, 6);
    expect(real).toBeCloseTo((Math.atan2(45, 90) * 180) / Math.PI, 4);
    expect(real).toBeLessThan(drawn);
  });

  it('returns 0 for a degenerate arm rather than NaN', () => {
    expect(angleDeg(null, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });
});

describe('pathMetrics', () => {
  const cal = calibrateFromEllipse(perpendicular); // 0,45 cm/px both ways

  /** A crude S-pull: up, in toward the lifter, up again, then a small loop
   *  back out — 100 px of total rise. */
  const pull = [
    { t: 0, x: 500, y: 400 },
    { t: 0.1, x: 494, y: 360 },
    { t: 0.2, x: 496, y: 330 },
    { t: 0.3, x: 508, y: 305 },
    { t: 0.4, x: 512, y: 300 },
  ];

  it('says nothing from a single mark', () => {
    const m = pathMetrics([pull[0]], cal);
    expect(m.pointCount).toBe(1);
    expect(m.durationS).toBe(0);
    expect(m.riseCm).toBe(0);
  });

  it('measures rise, loop and drift in centimetres', () => {
    const m = pathMetrics(pull, cal);
    expect(m.calibrated).toBe(true);
    expect(m.durationS).toBeCloseTo(0.4, 6);
    expect(m.riseCm).toBeCloseTo(100 * 0.45, 6);
    expect(m.peakAboveStartCm).toBeCloseTo(100 * 0.45, 6);
    // Horizontal spread runs from x=494 to x=512.
    expect(m.loopWidthCm).toBeCloseTo(18 * 0.45, 6);
    expect(m.netDriftCm).toBeCloseTo(12 * 0.45, 6);
    expect(m.pathLengthCm).toBeGreaterThan(m.riseCm);
  });

  it('falls back to pixels without a calibration, and says so', () => {
    const m = pathMetrics(pull, null);
    expect(m.calibrated).toBe(false);
    expect(m.riseCm).toBeCloseTo(100, 6);
    expect(m.netDriftCm).toBeCloseTo(12, 6);
  });

  it('uses real timestamps, so a variable-rate clip is timed correctly', () => {
    const vfr = [
      { t: 0, x: 0, y: 0 },
      { t: 0.017, x: 0, y: -10 },
      { t: 0.052, x: 0, y: -20 },
    ];
    expect(pathMetrics(vfr, null).durationS).toBeCloseTo(0.052, 6);
  });
});
