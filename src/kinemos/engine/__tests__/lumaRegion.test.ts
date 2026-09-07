/**
 * The luma-region read, against a frame that is a plain object.
 *
 * The reference for every rotation is the whole-image rotation a canvas
 * performs — clockwise 90°: new(x, y) = old(y, H − 1 − x) — applied to the
 * whole coded plane, so the region read is checked against what the canvas
 * path would have shown the tracker, pixel for pixel.
 */
import { describe, expect, it } from 'vitest';
import {
  alignOutward,
  codedToDisplay,
  displaySizeOf,
  displayToCoded,
  lumaReadable,
  readLumaRegion,
  type LumaFrameLike,
  type Rotation,
} from '../lumaRegion';
import type { FrameRegion, GrayImage } from '../tracker';

const CW = 64;
const CH = 48;
/** A coded luma plane with no symmetry to hide a wrong rotation behind. */
const codedY = (x: number, y: number): number => (x * 7 + y * 13 + ((x * y) % 5)) % 251;

/** The coded plane rotated clockwise by `rotation`, as a canvas would show it. */
function displayImage(rotation: Rotation): { width: number; height: number; at: (x: number, y: number) => number } {
  const { width, height } = displaySizeOf(rotation, CW, CH);
  const at = (x: number, y: number): number => {
    switch (rotation) {
      case 90:
        return codedY(y, CH - 1 - x);
      case 180:
        return codedY(CW - 1 - x, CH - 1 - y);
      case 270:
        return codedY(CW - 1 - y, x);
      default:
        return codedY(x, y);
    }
  };
  return { width, height, at };
}

interface MockFrame extends LumaFrameLike {
  calls: FrameRegion[];
}

/** A frame whose `copyTo` behaves as the browser's does: refuses a rect off
 *  the frame or, for a subsampled format, on odd coordinates; pads the rows
 *  so a reader that ignores the stride is caught. */
function mockFrame(format: string | null, rgb?: readonly [number, number, number]): MockFrame {
  const bps = rgb ? 4 : 1;
  const subsampled = format === 'NV12' || format === 'I420' || format === 'I420A';
  const calls: FrameRegion[] = [];
  return {
    format,
    codedWidth: CW,
    codedHeight: CH,
    calls,
    allocationSize({ rect }) {
      return 16 + rect.height * (rect.width * bps + 8) + rect.width * rect.height;
    },
    copyTo(dest, { rect }) {
      calls.push(rect);
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > CW || rect.y + rect.height > CH) {
        return Promise.reject(new TypeError('rect is not within the coded frame'));
      }
      if (subsampled && (rect.x % 2 || rect.y % 2 || rect.width % 2 || rect.height % 2)) {
        return Promise.reject(new TypeError('rect is not sample-aligned'));
      }
      const offset = 16;
      const stride = rect.width * bps + 8;
      for (let v = 0; v < rect.height; v++) {
        for (let u = 0; u < rect.width; u++) {
          const value = codedY(rect.x + u, rect.y + v);
          const at = offset + v * stride + u * bps;
          if (rgb) {
            // A grey pixel in the format's byte order, so luma equals the value.
            dest[at + rgb[0]] = value;
            dest[at + rgb[1]] = value;
            dest[at + rgb[2]] = value;
            dest[at + 3] = 255;
          } else {
            dest[at] = value;
          }
        }
      }
      return Promise.resolve(
        subsampled
          ? [
              { offset, stride },
              { offset: offset + rect.height * stride, stride: rect.width },
            ]
          : [{ offset, stride }],
      );
    },
  };
}

function expectCovers(image: GrayImage, region: FrameRegion, ref: ReturnType<typeof displayImage>): void {
  const ox = image.originX ?? 0;
  const oy = image.originY ?? 0;
  expect(ox).toBeLessThanOrEqual(Math.max(0, region.x));
  expect(oy).toBeLessThanOrEqual(Math.max(0, region.y));
  expect(ox + image.width).toBeGreaterThanOrEqual(Math.min(ref.width, region.x + region.width));
  expect(oy + image.height).toBeGreaterThanOrEqual(Math.min(ref.height, region.y + region.height));
  for (let j = 0; j < image.height; j++) {
    for (let i = 0; i < image.width; i++) {
      expect(image.data[j * image.width + i]).toBe(ref.at(ox + i, oy + j));
    }
  }
}

const ROTATIONS: Rotation[] = [0, 90, 180, 270];

describe('displayToCoded / codedToDisplay', () => {
  it('are inverses under every rotation', () => {
    const rect = { x: 5, y: 9, width: 12, height: 7 };
    for (const r of ROTATIONS) {
      expect(codedToDisplay(displayToCoded(rect, r, CW, CH), r, CW, CH)).toEqual(rect);
    }
  });

  it('map a display rect onto the coded pixels a canvas would have drawn', () => {
    // Each display pixel of the rect, mapped as a 1 × 1 rect, must land on
    // the coded pixel whose value the rotated image shows there — and inside
    // the rect the whole region maps to.
    const rect = { x: 3, y: 10, width: 9, height: 4 };
    for (const r of ROTATIONS) {
      const coded = displayToCoded(rect, r, CW, CH);
      const ref = displayImage(r);
      expect(coded.width * coded.height).toBe(rect.width * rect.height);
      for (let j = 0; j < rect.height; j++) {
        for (let i = 0; i < rect.width; i++) {
          const x = rect.x + i;
          const y = rect.y + j;
          const p = displayToCoded({ x, y, width: 1, height: 1 }, r, CW, CH);
          expect(codedY(p.x, p.y)).toBe(ref.at(x, y));
          expect(p.x).toBeGreaterThanOrEqual(coded.x);
          expect(p.x).toBeLessThan(coded.x + coded.width);
          expect(p.y).toBeGreaterThanOrEqual(coded.y);
          expect(p.y).toBeLessThan(coded.y + coded.height);
        }
      }
    }
  });

  it('swap the sides for a quarter turn', () => {
    expect(displaySizeOf(90, CW, CH)).toEqual({ width: CH, height: CW });
    expect(displaySizeOf(180, CW, CH)).toEqual({ width: CW, height: CH });
  });
});

describe('alignOutward', () => {
  it('widens an odd rect onto the even grid without losing a pixel of it', () => {
    expect(alignOutward({ x: 3, y: 5, width: 7, height: 9 }, CW, CH, 2)).toEqual({
      x: 2,
      y: 4,
      width: 8,
      height: 10,
    });
  });

  it('clamps to the frame', () => {
    expect(alignOutward({ x: -10, y: 40, width: 30, height: 30 }, CW, CH, 2)).toEqual({
      x: 0,
      y: 40,
      width: 20,
      height: 8,
    });
  });

  it('is null for a rect wholly off the frame', () => {
    expect(alignOutward({ x: 100, y: 0, width: 10, height: 10 }, CW, CH, 2)).toBeNull();
    expect(alignOutward({ x: 0, y: -20, width: 10, height: 10 }, CW, CH, 1)).toBeNull();
  });
});

describe('lumaReadable', () => {
  it('knows the decoder formats and refuses the rest', () => {
    for (const f of ['NV12', 'I420', 'I420A', 'I422', 'I444', 'RGBA', 'BGRX']) expect(lumaReadable(f)).toBe(true);
    expect(lumaReadable(null)).toBe(false);
    expect(lumaReadable('P010')).toBe(false);
  });
});

describe('readLumaRegion', () => {
  it('serves the region in display orientation under every rotation', async () => {
    const region = { x: 7, y: 11, width: 13, height: 9 };
    for (const r of ROTATIONS) {
      const frame = mockFrame('NV12');
      const image = await readLumaRegion(frame, region, r);
      expect(image).not.toBeNull();
      expectCovers(image!, region, displayImage(r));
      // The copy asked for an even-aligned rect inside the coded frame.
      expect(frame.calls).toHaveLength(1);
      const rect = frame.calls[0];
      expect(rect.x % 2).toBe(0);
      expect(rect.width % 2).toBe(0);
    }
  });

  it('serves the visible part of a region that overhangs the frame', async () => {
    for (const r of ROTATIONS) {
      const size = displaySizeOf(r, CW, CH);
      const region = { x: size.width - 6, y: -4, width: 20, height: 12 };
      const image = await readLumaRegion(mockFrame('I420'), region, r);
      expect(image).not.toBeNull();
      expect(image!.originX! + image!.width).toBe(size.width);
      expect(image!.originY).toBe(0);
      expectCovers(image!, region, displayImage(r));
    }
  });

  it('weights luma from the bytes of an RGB frame', async () => {
    const region = { x: 2, y: 3, width: 5, height: 4 };
    const image = await readLumaRegion(mockFrame('BGRA', [2, 1, 0]), region, 90);
    expect(image).not.toBeNull();
    // Grey pixels, so R = G = B = value and the weighting reproduces it.
    const ref = displayImage(90);
    for (let j = 0; j < image!.height; j++) {
      for (let i = 0; i < image!.width; i++) {
        expect(image!.data[j * image!.width + i]).toBeCloseTo(
          ref.at(image!.originX! + i, image!.originY! + j),
          5,
        );
      }
    }
  });

  it('declines a format it cannot read, so the caller falls back', async () => {
    expect(await readLumaRegion(mockFrame(null), { x: 0, y: 0, width: 8, height: 8 }, 0)).toBeNull();
  });

  it('declines a region wholly off the frame', async () => {
    const frame = mockFrame('NV12');
    expect(await readLumaRegion(frame, { x: 200, y: 200, width: 8, height: 8 }, 0)).toBeNull();
    expect(frame.calls).toHaveLength(0);
  });
});
