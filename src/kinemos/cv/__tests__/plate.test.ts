/**
 * Plate detection and the sub-pixel snap, against plates the tests drew and
 * therefore know the position of to the hundredth of a pixel.
 */
import { describe, expect, it } from 'vitest';
import { detectPlates, findPlate, refinePlateEllipse } from '../plate';
import { renderScene } from './scene';

const W = 384;
const H = 288;

describe('detectPlates', () => {
  it('finds a plate to within a pixel with no hint at all', async () => {
    const gray = renderScene({ width: W, height: H, plate: { cx: 150.4, cy: 200.6, a: 22, b: 22, tiltDeg: 0 }, noise: 3 });
    const found = await detectPlates(gray, { minRadiusPx: 12, maxRadiusPx: 40 });
    expect(found.length).toBeGreaterThan(0);
    const best = found[0];
    expect(Math.hypot(best.cx - 150.4, best.cy - 200.6)).toBeLessThan(1.5);
    expect(Math.abs(best.r - 22)).toBeLessThan(2);
    expect(best.support).toBeGreaterThan(0.7);
  }, 30_000);

  it('prefers the candidate near the hint', async () => {
    // Two plates: the far one bigger and brighter-edged, the near one the
    // coach clicked beside.
    const gray = renderScene({ width: W, height: H, plate: { cx: 120, cy: 210, a: 20, b: 20, tiltDeg: 0 } });
    const second = renderScene({ width: W, height: H, plate: { cx: 260, cy: 150, a: 30, b: 30, tiltDeg: 0 } });
    for (let i = 0; i < gray.data.length; i++) if (second.data[i] >= 200 || second.data[i] === 105 || second.data[i] === 45) gray.data[i] = second.data[i];
    const found = await detectPlates(gray, { minRadiusPx: 12, maxRadiusPx: 40, near: { x: 126, y: 205 } });
    expect(found.length).toBeGreaterThan(0);
    expect(Math.hypot(found[0].cx - 120, found[0].cy - 210)).toBeLessThan(2);
  }, 30_000);

  it('returns nothing on a scene with no plate', async () => {
    const gray = renderScene({ width: W, height: H, noise: 3 });
    const found = await detectPlates(gray, { minRadiusPx: 12, maxRadiusPx: 40 });
    // The texture can produce a weak false circle; none should have real
    // edge support.
    expect(found.every(c => c.support < 0.6)).toBe(true);
  }, 30_000);
});

describe('refinePlateEllipse', () => {
  it('snaps a rough outline onto the plate edge at sub-pixel', async () => {
    const plate = { cx: 150.37, cy: 200.61, a: 22.4, b: 19.2, tiltDeg: 6 };
    const gray = renderScene({ width: W, height: H, plate, noise: 2 });
    // The coach's guess: two pixels off, a pixel too big, untilted.
    const out = await refinePlateEllipse(gray, { cx: 152, cy: 199, semiMajorPx: 23.5, semiMinorPx: 20.5, tiltDeg: 0 });
    expect(out).not.toBeNull();
    const e = out!.ellipse;
    // Canny edges sit on whole pixels; the fit averages them to a fraction.
    expect(Math.abs(e.cx - plate.cx)).toBeLessThan(0.5);
    expect(Math.abs(e.cy - plate.cy)).toBeLessThan(0.5);
    expect(Math.abs(e.semiMajorPx - plate.a)).toBeLessThan(0.8);
    expect(Math.abs(e.semiMinorPx - plate.b)).toBeLessThan(0.8);
    // Tilt is weakly determined on a mildly squashed ellipse (a/b ≈ 1,17), and
    // costs little: 5° of tilt error moves the vertical scale by 0,4 %.
    expect(Math.abs(e.tiltDeg - plate.tiltDeg)).toBeLessThan(5);
    expect(out!.support).toBeGreaterThan(0.85);
  }, 30_000);

  it('reports weak support for a plate that is half hidden', async () => {
    const plate = { cx: 150, cy: 200, a: 22, b: 22, tiltDeg: 0 };
    const gray = renderScene({ width: W, height: H, plate });
    // A thigh across the left half.
    for (let y = 0; y < H; y++) for (let x = 0; x < 150; x++) gray.data[y * W + x] = 60;
    const out = await refinePlateEllipse(gray, { cx: 151, cy: 201, semiMajorPx: 23, semiMinorPx: 23, tiltDeg: 0 });
    expect(out).not.toBeNull();
    expect(out!.support).toBeLessThan(0.7);
  }, 30_000);

  it('is null where there is no edge to snap to', async () => {
    const gray = renderScene({ width: W, height: H });
    const out = await refinePlateEllipse(gray, { cx: 150, cy: 200, semiMajorPx: 22, semiMinorPx: 22, tiltDeg: 0 });
    expect(out === null || out.support < 0.5).toBe(true);
  }, 30_000);
});

describe('findPlate', () => {
  it('goes from nothing to a snapped outline in one call', async () => {
    const plate = { cx: 200.25, cy: 180.75, a: 26, b: 23, tiltDeg: -4 };
    const gray = renderScene({ width: W, height: H, plate, noise: 2 });
    const out = await findPlate(gray, { minRadiusPx: 12, maxRadiusPx: 40 });
    expect(out).not.toBeNull();
    expect(Math.abs(out!.ellipse.cx - plate.cx)).toBeLessThan(0.5);
    expect(Math.abs(out!.ellipse.cy - plate.cy)).toBeLessThan(0.5);
    expect(Math.abs(out!.ellipse.semiMajorPx - plate.a)).toBeLessThan(1.0);
    expect(Math.abs(out!.ellipse.semiMinorPx - plate.b)).toBeLessThan(1.0);
  }, 30_000);
});
