/**
 * The lens, tested the way it is used: bend a set of straight lines by a
 * known k1 and check the fit finds that k1 back, and that undistorting undoes
 * distorting exactly.
 */
import { describe, expect, it } from 'vitest';
import type { PlateEllipse, PxPoint } from '../calibration';
import { calibrateFromEllipse } from '../calibration';
import {
  MIN_SENSITIVITY,
  distortPoint,
  distortionFor,
  fitDistortion,
  noDistortion,
  probeSensitivity,
  straightnessResidualPx,
  totalStraightness,
  undistortEllipse,
  undistortPoint,
  undistortPoints,
} from '../distortion';

const W = 1080;
const H = 1920;

/** Straight lines a gym actually contains: two rack uprights, the platform
 *  edge, a door frame, the top of a whiteboard. */
function straightChains(): PxPoint[][] {
  const chains: PxPoint[][] = [];
  const vertical = (x: number, y0: number, y1: number) => {
    const c: PxPoint[] = [];
    for (let y = y0; y <= y1; y += 8) c.push({ x, y });
    return c;
  };
  const horizontal = (y: number, x0: number, x1: number) => {
    const c: PxPoint[] = [];
    for (let x = x0; x <= x1; x += 8) c.push({ x, y });
    return c;
  };
  chains.push(vertical(160, 300, 1300));
  chains.push(vertical(900, 250, 1400));
  chains.push(horizontal(1500, 80, 1000));
  chains.push(horizontal(420, 120, 980));
  chains.push(vertical(540, 200, 900));
  return chains;
}

function bend(chains: PxPoint[][], k1: number): PxPoint[][] {
  const model = distortionFor(W, H, k1);
  return chains.map(c => c.map(p => distortPoint(model, p)));
}

describe('the division model', () => {
  const model = distortionFor(W, H, -0.12);

  it('is the identity at k1 = 0', () => {
    const none = noDistortion(W, H);
    const p = { x: 137, y: 902 };
    expect(undistortPoint(none, p)).toEqual(p);
    expect(distortPoint(none, p)).toEqual(p);
  });

  it('leaves the centre alone and moves the corners most', () => {
    const centre = undistortPoint(model, { x: model.cx, y: model.cy });
    expect(centre.x).toBeCloseTo(model.cx, 9);
    expect(centre.y).toBeCloseTo(model.cy, 9);
    const near = undistortPoint(model, { x: model.cx + 50, y: model.cy });
    const far = undistortPoint(model, { x: model.cx + 500, y: model.cy });
    expect(near.x - (model.cx + 50)).toBeLessThan(far.x - (model.cx + 500));
  });

  it('pushes points outward for barrel and inward for pincushion', () => {
    const p = { x: model.cx + 400, y: model.cy + 300 };
    expect(undistortPoint(distortionFor(W, H, -0.15), p).x).toBeGreaterThan(p.x);
    expect(undistortPoint(distortionFor(W, H, 0.15), p).x).toBeLessThan(p.x);
  });

  it('undistorts exactly what it distorted', () => {
    for (const p of [
      { x: 10, y: 20 },
      { x: 1070, y: 1900 },
      { x: 540, y: 960 },
      { x: 900, y: 200 },
    ]) {
      const back = undistortPoint(model, distortPoint(model, p));
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });
});

describe('straightness', () => {
  it('is zero for a straight run and grows with the bend', () => {
    const line = straightChains()[0];
    expect(straightnessResidualPx(line)).toBeCloseTo(0, 9);
    expect(straightnessResidualPx(bend([line], -0.2)[0])).toBeGreaterThan(1);
  });

  it('measures a vertical line, which a y-on-x regression could not', () => {
    const vertical: PxPoint[] = [
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 100, y: 100 },
    ];
    expect(straightnessResidualPx(vertical)).toBeCloseTo(0, 9);
  });

  it('is smallest under the lens that actually bent the lines', () => {
    const bent = bend(straightChains(), -0.14);
    const right = totalStraightness(distortionFor(W, H, -0.14), bent);
    expect(right).toBeLessThan(totalStraightness(distortionFor(W, H, 0), bent));
    expect(right).toBeLessThan(totalStraightness(distortionFor(W, H, -0.05), bent));
    expect(right).toBeLessThan(totalStraightness(distortionFor(W, H, -0.25), bent));
  });
});

describe('fitDistortion', () => {
  it('recovers a barrel lens from bent gym edges', () => {
    const fit = fitDistortion(bend(straightChains(), -0.14), W, H)!;
    expect(fit).not.toBeNull();
    expect(fit.model.k1).toBeCloseTo(-0.14, 2);
    expect(fit.residualAfterPx).toBeLessThan(fit.residualBeforePx);
    expect(fit.improvement).toBeGreaterThan(0.9);
    expect(fit.chains).toBe(5);
  });

  it('recovers a pincushion lens too', () => {
    const fit = fitDistortion(bend(straightChains(), 0.1), W, H)!;
    expect(fit.model.k1).toBeCloseTo(0.1, 2);
  });

  it('refuses a frame whose lines are already straight', () => {
    // Nothing to improve on: the honest answer is no model, not k1 ≈ 0 with
    // a confident air.
    expect(fitDistortion(straightChains(), W, H)).toBeNull();
  });

  it('refuses when there is too little to fit on', () => {
    const chains = bend(straightChains(), -0.14).slice(0, 2);
    expect(fitDistortion(chains, W, H)).toBeNull();
    expect(fitDistortion([], W, H)).toBeNull();
  });

  it('refuses chains too short to say anything', () => {
    const stubs = bend(straightChains(), -0.14).map(c => c.slice(0, 5));
    expect(fitDistortion(stubs, W, H)).toBeNull();
  });
});

describe('probeSensitivity', () => {
  /**
   * The case measured on a real 576×1024 phone clip (P3 plan §12): plenty of
   * edges, every one of them about a tenth of the diagonal, near the middle
   * of the frame, and carrying the pixel noise a real edge detector leaves.
   * Bending those by a typical lens moved their pooled residual by a fifth
   * of a per cent.
   */
  function shortNoisyChains(): PxPoint[][] {
    const out: PxPoint[][] = [];
    let seed = 7;
    const jitter = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648 - 0.5;
    };
    for (let k = 0; k < 6; k++) {
      const c: PxPoint[] = [];
      for (let y = 900; y <= 1020; y += 2) c.push({ x: Math.round(500 + k * 12 + jitter()), y });
      out.push(c);
    }
    return out;
  }

  it('is high for long edges across the frame', () => {
    expect(probeSensitivity(straightChains(), W, H)).toBeGreaterThan(MIN_SENSITIVITY);
  });

  it('is near zero for short noisy edges near the middle, which cannot tell', () => {
    expect(probeSensitivity(shortNoisyChains(), W, H)).toBeLessThan(MIN_SENSITIVITY);
  });

  it('refuses to fit edges it could not read a lens from, even a bent one', () => {
    // Bending them changes far less than their own noise, so any k1 fitted
    // to them would be fitted to the noise: the honest answer is none.
    expect(fitDistortion(bend(shortNoisyChains(), -0.14), W, H)).toBeNull();
  });
});

describe('undistortEllipse', () => {
  const model = distortionFor(W, H, -0.14);

  it('leaves a centred plate almost alone and grows one at the edge', () => {
    const centred: PlateEllipse = { cx: W / 2, cy: H / 2, semiMajorPx: 80, semiMinorPx: 78, tiltDeg: 0 };
    const corrected = undistortEllipse(model, centred);
    expect(corrected.semiMajorPx).toBeCloseTo(80, 0);

    const edge: PlateEllipse = { cx: 180, cy: 1600, semiMajorPx: 80, semiMinorPx: 78, tiltDeg: 0 };
    // A barrel lens shrinks what it pushes to the edge, so undistorting it
    // gives the plate back its true size: bigger than it was measured.
    expect(undistortEllipse(model, edge).semiMajorPx).toBeGreaterThan(80);
  });

  it('changes the scale a lift is measured with', () => {
    const edge: PlateEllipse = { cx: 180, cy: 1600, semiMajorPx: 80, semiMinorPx: 78, tiltDeg: 0 };
    const raw = calibrateFromEllipse(edge, 45);
    const corrected = calibrateFromEllipse(undistortEllipse(model, edge), 45);
    expect(corrected.cmPerPxV).toBeLessThan(raw.cmPerPxV);
  });

  it('is the identity without a lens', () => {
    const e: PlateEllipse = { cx: 300, cy: 400, semiMajorPx: 80, semiMinorPx: 70, tiltDeg: 12 };
    expect(undistortEllipse(noDistortion(W, H), e)).toEqual(e);
  });
});

describe('undistortPoints', () => {
  it('keeps whatever else a point carries', () => {
    const track = [
      { t: 1, x: 100, y: 200, s: 't' as const },
      { t: 2, x: 900, y: 1800, s: 'm' as const },
    ];
    const out = undistortPoints(distortionFor(W, H, -0.14), track);
    expect(out[0].t).toBe(1);
    expect(out[1].s).toBe('m');
    expect(out[1].x).not.toBe(900);
  });
});
