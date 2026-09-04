/**
 * The marker tier on drawn frames: an orange sticker on a bar end that moves
 * along a known path, past a red shoe and a blue plate that must not be
 * mistaken for it.
 */
import { describe, expect, it } from 'vitest';
import { trackMarker, type RgbaSource } from '../markerTracker';
import type { RgbaImage } from '../plateColour';

const W = 240;
const H = 320;
const FRAMES = 24;
const MARKER_R = 6;

/** The truth: an S-shaped pull, sub-pixel by construction. */
function truthAt(i: number): { x: number; y: number } {
  const u = i / (FRAMES - 1);
  return { x: 120 + 18 * Math.sin(u * Math.PI * 2) + 0.4, y: 260 - 180 * u + 0.3 };
}

function frame(i: number, options: { hideMarker?: boolean } = {}): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const k = (y * W + x) * 4;
    data[k] = r;
    data[k + 1] = g;
    data[k + 2] = b;
    data[k + 3] = 255;
  };
  // A grey gym, a blue plate behind the bar, a red shoe on the floor.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) put(x, y, 105 + ((x * 3 + y) % 7), 104 + ((x + y) % 5), 103);
  }
  const { x: mx, y: my } = truthAt(i);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (Math.hypot(x - mx, y - my) <= 34) put(x, y, 30, 60, 190); // the plate
      if (Math.hypot(x - 40, y - 300) <= 14) put(x, y, 200, 30, 30); // the shoe
    }
  }
  if (!options.hideMarker) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (Math.hypot(x - mx, y - my) <= MARKER_R) put(x, y, 245, 140, 20); // the marker
      }
    }
  }
  return { data, width: W, height: H };
}

function source(hidden: number[] = []): RgbaSource {
  return {
    frameCount: FRAMES,
    timestamps: Array.from({ length: FRAMES }, (_, i) => i / 30),
    getRgba: i => Promise.resolve(frame(i, { hideMarker: hidden.includes(i) })),
  };
}

describe('trackMarker', () => {
  it('follows the marker through the whole clip, to a fraction of a pixel', async () => {
    const start = truthAt(0);
    const result = await trackMarker(source(), { index: 0, x: start.x, y: start.y }, { radiusPx: MARKER_R });
    expect(result.colour).not.toBeNull();
    expect(result.points).toHaveLength(FRAMES);
    expect(result.gaveUp).toBe(false);

    let worst = 0;
    let sum = 0;
    for (const p of result.points) {
      const t = truthAt(p.index);
      const e = Math.hypot(p.x - t.x, p.y - t.y);
      worst = Math.max(worst, e);
      sum += e * e;
    }
    const rms = Math.sqrt(sum / result.points.length);
    // The tier the grade prices at 0,4 px.
    expect(rms).toBeLessThan(0.4);
    expect(worst).toBeLessThan(1);
  });

  it('reads the marker as orange, not the plate it sits on', async () => {
    const start = truthAt(0);
    const result = await trackMarker(source(), { index: 0, x: start.x, y: start.y }, { radiusPx: MARKER_R });
    // Orange sits near 30°; the plate is blue at 220°.
    expect(result.colour!.hueDeg).toBeGreaterThan(15);
    expect(result.colour!.hueDeg).toBeLessThan(50);
  });

  it('rides out a few frames where the marker is hidden', async () => {
    const start = truthAt(0);
    const result = await trackMarker(
      source([5, 6, 7]),
      { index: 0, x: start.x, y: start.y },
      { radiusPx: MARKER_R },
    );
    expect(result.gaveUp).toBe(false);
    // The hidden frames produce no point but are reported as unsure.
    expect(result.points).toHaveLength(FRAMES - 3);
    for (const i of [5, 6, 7]) expect(result.lowConfidenceIndices).toContain(i);
  });

  it('gives up when the marker never comes back', async () => {
    const start = truthAt(0);
    const hidden = Array.from({ length: FRAMES }, (_, i) => i).filter(i => i >= 4);
    const result = await trackMarker(
      source(hidden),
      { index: 0, x: start.x, y: start.y },
      { radiusPx: MARKER_R, giveUpAfter: 4 },
    );
    expect(result.gaveUp).toBe(true);
    expect(result.points.length).toBeLessThan(FRAMES);
  });

  it('says so when the anchor is not on a marker at all', async () => {
    // Clicked on the grey wall: no colour, so no tier.
    const result = await trackMarker(source(), { index: 0, x: 20, y: 20 }, { radiusPx: MARKER_R });
    expect(result.colour).toBeNull();
    expect(result.points).toHaveLength(0);
    expect(result.gaveUp).toBe(true);
  });
});
