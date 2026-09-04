/**
 * Colour on a synthetic frame: a blue plate on a grey floor, a grey fan of
 * the same size next to it, and a lifter's red shoe for good measure. The
 * questions are the ones the set tracker asks — is this round thing the
 * plate, and where did the plate go.
 */
import { describe, expect, it } from 'vitest';
import type { PlateEllipse } from '../calibration';
import {
  colourMatchFraction,
  findColourBlob,
  hueChroma,
  samplePlateColour,
  type RgbaImage,
} from '../plateColour';

const W = 320;
const H = 240;

function frame(paint: (x: number, y: number) => [number, number, number]): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * W + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

const disc = (cx: number, cy: number, r: number, x: number, y: number) => Math.hypot(x - cx, y - cy) <= r;

/** Blue plate with a metal hub at (80, 120), grey fan at (220, 120), red
 *  shoe bottom-left. Floor is a mid grey with a little noise. */
function scene(plateAt: { x: number; y: number } = { x: 80, y: 120 }): RgbaImage {
  return frame((x, y) => {
    if (disc(plateAt.x, plateAt.y, 30, x, y)) {
      if (disc(plateAt.x, plateAt.y, 9, x, y)) return [150, 150, 155]; // hub
      // Shaded plate: darker at the bottom, still blue.
      const shade = 0.75 + 0.25 * ((plateAt.y - y) / 30);
      return [Math.round(30 * shade), Math.round(60 * shade), Math.round(190 * shade)];
    }
    if (disc(220, 120, 30, x, y)) return [120 + ((x * 7) % 11), 120 + ((y * 5) % 11), 122];
    if (x < 50 && y > 200) return [200, 30, 30];
    return [100 + ((x * 3 + y * 5) % 9), 100 + ((x + y) % 7), 100];
  });
}

const plate: PlateEllipse = { cx: 80, cy: 120, semiMajorPx: 30, semiMinorPx: 30, tiltDeg: 0 };
const fan: PlateEllipse = { cx: 220, cy: 120, semiMajorPx: 30, semiMinorPx: 30, tiltDeg: 0 };

describe('hueChroma', () => {
  it('reads the primaries and grey', () => {
    expect(hueChroma(255, 0, 0).hue).toBe(0);
    expect(hueChroma(0, 255, 0).hue).toBe(120);
    expect(hueChroma(0, 0, 255).hue).toBe(240);
    expect(hueChroma(90, 90, 90).chroma).toBe(0);
  });
});

describe('samplePlateColour', () => {
  it('learns a blue plate as blue, hub and all', () => {
    const model = samplePlateColour(scene(), plate)!;
    expect(model).not.toBeNull();
    expect(model.hueDeg).toBeGreaterThan(215);
    expect(model.hueDeg).toBeLessThan(245);
    expect(model.coverage).toBeGreaterThan(0.95);
    expect(model.hueToleranceDeg).toBeGreaterThanOrEqual(12);
  });

  it('has no model for a grey plate', () => {
    expect(samplePlateColour(scene(), fan)).toBeNull();
  });
});

describe('colourMatchFraction', () => {
  const model = samplePlateColour(scene(), plate)!;

  it('scores the plate high and the fan low', () => {
    expect(colourMatchFraction(scene(), plate, model)).toBeGreaterThan(0.9);
    expect(colourMatchFraction(scene(), fan, model)).toBeLessThan(0.05);
  });

  it('still scores a plate that moved', () => {
    const moved = scene({ x: 150, y: 60 });
    expect(colourMatchFraction(moved, { ...plate, cx: 150, cy: 60 }, model)).toBeGreaterThan(0.9);
  });
});

describe('findColourBlob', () => {
  const model = samplePlateColour(scene(), plate)!;

  it('finds the plate where it went, not the fan and not the shoe', () => {
    const later = scene({ x: 150, y: 60 });
    const blob = findColourBlob(later, model, { near: { x: 80, y: 120 }, searchRadiusPx: 120, radiusPx: 30 })!;
    expect(blob).not.toBeNull();
    expect(Math.abs(blob.x - 150)).toBeLessThan(4);
    expect(Math.abs(blob.y - 60)).toBeLessThan(4);
    expect(blob.fill).toBeGreaterThan(0.7);
    expect(blob.fill).toBeLessThan(1.2);
  });

  it('returns nothing when the plate is out of reach', () => {
    const later = scene({ x: 300, y: 30 });
    expect(findColourBlob(later, model, { near: { x: 80, y: 120 }, searchRadiusPx: 60, radiusPx: 30 })).toBeNull();
  });

  it('ignores a patch far too small to be a plate', () => {
    const speck = frame((x, y) => (disc(100, 100, 4, x, y) ? [30, 60, 190] : [100, 100, 100]));
    expect(findColourBlob(speck, model, { near: { x: 100, y: 100 }, searchRadiusPx: 60, radiusPx: 30 })).toBeNull();
  });
});
