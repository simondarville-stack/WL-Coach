import { describe, expect, it } from 'vitest';
import {
  clampCropToFrame,
  CROP_RATIOS,
  fitCropToRatio,
  MIN_CROP_EDGE,
  moveCrop,
  ratioInFractionSpace,
  resizeCrop,
} from '../clipCropGeometry';
import {
  FULL_FRAME,
  isNoopEdit,
  isResize,
  outputDimensions,
  REVIEW_CLIP_MAX_EDGE,
  reviewClipBitrate,
  type ClipEdit,
} from '../videoClipEdit';

const edit = (over: Partial<ClipEdit> = {}): ClipEdit => ({
  start: 0,
  end: 10,
  crop: null,
  maxEdge: null,
  ...over,
});

/** Every rectangle the editor produces must survive this. */
function expectInsideFrame(c: { x: number; y: number; w: number; h: number }) {
  expect(c.x).toBeGreaterThanOrEqual(-1e-9);
  expect(c.y).toBeGreaterThanOrEqual(-1e-9);
  expect(c.x + c.w).toBeLessThanOrEqual(1 + 1e-9);
  expect(c.y + c.h).toBeLessThanOrEqual(1 + 1e-9);
  expect(c.w).toBeGreaterThanOrEqual(MIN_CROP_EDGE - 1e-9);
  expect(c.h).toBeGreaterThanOrEqual(MIN_CROP_EDGE - 1e-9);
}

describe('isNoopEdit', () => {
  it('treats an untouched full-length clip as a no-op', () => {
    expect(isNoopEdit(edit({ end: 10 }), 10)).toBe(true);
    expect(isNoopEdit(edit({ crop: FULL_FRAME }), 10)).toBe(true);
  });

  it('spots a trim, a crop and a resolution cap', () => {
    expect(isNoopEdit(edit({ start: 2 }), 10)).toBe(false);
    expect(isNoopEdit(edit({ end: 8 }), 10)).toBe(false);
    expect(isNoopEdit(edit({ crop: { x: 0.1, y: 0, w: 0.9, h: 1 } }), 10)).toBe(false);
    expect(isNoopEdit(edit({ maxEdge: 1280 }), 10)).toBe(false);
  });

  it('ignores a ceiling the frame already sits under', () => {
    // The review default (1080p) on a 1080p phone clip is not an edit — the
    // untouched clip must still read as "Upload", not "Save & upload".
    const hd = { w: 1920, h: 1080 };
    expect(isNoopEdit(edit({ maxEdge: REVIEW_CLIP_MAX_EDGE }), 10, hd)).toBe(true);
    expect(isNoopEdit(edit({ maxEdge: REVIEW_CLIP_MAX_EDGE }), 10, { w: 1080, h: 1920 })).toBe(true);
    // …but it is one on 4K, and a crop that stays wider than the ceiling too.
    expect(isNoopEdit(edit({ maxEdge: REVIEW_CLIP_MAX_EDGE }), 10, { w: 3840, h: 2160 })).toBe(false);
    expect(isResize(edit({ maxEdge: 1280, crop: { x: 0, y: 0, w: 0.5, h: 1 } }), { w: 3840, h: 2160 })).toBe(true);
    // A 4K frame cropped to its middle quarter is 1920×1080 — already under
    // the ceiling, so no resize.
    expect(isResize(edit({ maxEdge: 1920, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }), { w: 3840, h: 2160 })).toBe(false);
    // Frame unknown: a set ceiling is assumed to bind.
    expect(isResize(edit({ maxEdge: 1920 }), null)).toBe(true);
    expect(isResize(edit(), null)).toBe(false);
  });
});

describe('reviewClipBitrate', () => {
  it('lands 1080p30 in phone-recording territory', () => {
    const b = reviewClipBitrate(1920, 1080, 30);
    expect(b).toBeGreaterThan(6_000_000);
    expect(b).toBeLessThan(9_000_000);
  });

  it('grows with frame rate, but slower than linearly', () => {
    const at30 = reviewClipBitrate(1920, 1080, 30);
    const at60 = reviewClipBitrate(1920, 1080, 60);
    expect(at60).toBeGreaterThan(at30 * 1.3);
    expect(at60).toBeLessThan(at30 * 1.7);
  });

  it('scales with pixels and stays inside the floor and ceiling', () => {
    expect(reviewClipBitrate(1280, 720, 30)).toBeLessThan(reviewClipBitrate(1920, 1080, 30));
    // 4K "Original" is capped — the review player has to stream it on gym wifi.
    expect(reviewClipBitrate(3840, 2160, 60)).toBe(12_000_000);
    expect(reviewClipBitrate(320, 180, 30)).toBe(1_000_000);
  });

  it('never aims above the source, which re-encoding cannot improve on', () => {
    expect(reviewClipBitrate(1920, 1080, 30, 3_000_000)).toBe(3_000_000);
    // …but a hot source does not raise the target either.
    expect(reviewClipBitrate(1920, 1080, 30, 40_000_000)).toBe(reviewClipBitrate(1920, 1080, 30));
  });

  it('assumes 30 fps when the rate is unknown', () => {
    expect(reviewClipBitrate(1920, 1080, null)).toBe(reviewClipBitrate(1920, 1080, 30));
    expect(reviewClipBitrate(1920, 1080, NaN)).toBe(reviewClipBitrate(1920, 1080, 30));
  });

  it('is a whole number of kbit/s', () => {
    expect(reviewClipBitrate(1920, 1080, 59.94) % 1000).toBe(0);
  });
});

describe('outputDimensions', () => {
  it('keeps the source size when nothing is capped or cropped', () => {
    expect(outputDimensions(edit(), 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it('applies the crop before the ceiling', () => {
    const half = edit({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 }, maxEdge: 1280 });
    // 960×1080 cropped, then scaled so the long edge is 1280 → no change (1080 < 1280).
    expect(outputDimensions(half, 1920, 1080)).toEqual({ width: 960, height: 1080 });
  });

  it('never upscales', () => {
    expect(outputDimensions(edit({ maxEdge: 1920 }), 640, 480)).toEqual({ width: 640, height: 480 });
  });

  it('scales a 4K frame down to the ceiling', () => {
    expect(outputDimensions(edit({ maxEdge: 1280 }), 3840, 2160)).toEqual({ width: 1280, height: 720 });
  });

  it('always returns even dimensions, which H.264 requires', () => {
    const odd = outputDimensions(edit({ crop: { x: 0, y: 0, w: 1 / 3, h: 1 / 3 } }), 1001, 999);
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
  });
});

describe('ratioInFractionSpace', () => {
  it('makes a square crop of a 16:9 frame a tall fraction', () => {
    // A 1:1 output out of a 16:9 frame is 9/16 as wide as it is tall, in fractions.
    expect(ratioInFractionSpace(1, 16 / 9)).toBeCloseTo(9 / 16);
  });

  it('is the identity when the target matches the frame', () => {
    expect(ratioInFractionSpace(16 / 9, 16 / 9)).toBeCloseTo(1);
  });
});

describe('clampCropToFrame', () => {
  it('pulls a rectangle that overflows back inside', () => {
    expectInsideFrame(clampCropToFrame({ x: 0.8, y: 0.9, w: 0.5, h: 0.4 }));
  });

  it('enforces the minimum edge', () => {
    const c = clampCropToFrame({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 });
    expect(c.w).toBe(MIN_CROP_EDGE);
    expect(c.h).toBe(MIN_CROP_EDGE);
  });
});

describe('moveCrop', () => {
  it('stops at the edge instead of shrinking', () => {
    const c = moveCrop({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 0.4, 0.4);
    expect(c).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
  });

  it('translates within the frame', () => {
    const c = moveCrop({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 0.1, -0.05);
    expect(c.x).toBeCloseTo(0.2);
    expect(c.y).toBeCloseTo(0.05);
    expect(c.w).toBeCloseTo(0.2);
    expect(c.h).toBeCloseTo(0.2);
  });
});

describe('resizeCrop', () => {
  const base = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };

  it('keeps the opposite corner anchored', () => {
    const c = resizeCrop(base, 'nw', 0.4, 0.4, null);
    expect(c.x + c.w).toBeCloseTo(0.8);
    expect(c.y + c.h).toBeCloseTo(0.8);
  });

  it('clamps a drag past the frame edge', () => {
    expectInsideFrame(resizeCrop(base, 'se', 5, 5, null));
    expectInsideFrame(resizeCrop(base, 'nw', -5, -5, null));
  });

  it('holds a locked ratio', () => {
    const c = resizeCrop(base, 'se', 0.9, 0.3, 0.5);
    expect(c.w / c.h).toBeCloseTo(0.5);
    expectInsideFrame(c);
  });

  it('stays inside the frame even when the ratio wants to overflow', () => {
    const c = resizeCrop({ x: 0, y: 0.4, w: 0.3, h: 0.3 }, 'se', 1, 1, 4);
    expect(c.w / c.h).toBeCloseTo(4);
    expectInsideFrame(c);
  });

  it('never collapses below the minimum edge', () => {
    expectInsideFrame(resizeCrop(base, 'se', 0.2, 0.2, null));
    expectInsideFrame(resizeCrop(base, 'se', 0.2, 0.2, 1));
  });
});

describe('fitCropToRatio', () => {
  it('keeps the centre and adopts the ratio', () => {
    const before = { x: 0.1, y: 0.1, w: 0.6, h: 0.4 };
    const after = fitCropToRatio(before, 0.5);
    expect(after.w / after.h).toBeCloseTo(0.5);
    expect(after.x + after.w / 2).toBeCloseTo(before.x + before.w / 2);
    expect(after.y + after.h / 2).toBeCloseTo(before.y + before.h / 2);
    expectInsideFrame(after);
  });

  it('produces a usable box for every preset, on portrait and landscape frames', () => {
    for (const frameAspect of [9 / 16, 1, 16 / 9, 4 / 3]) {
      for (const { ratio } of CROP_RATIOS) {
        const fr = ratio == null ? null : ratioInFractionSpace(ratio, frameAspect);
        expectInsideFrame(fitCropToRatio({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, fr));
      }
    }
  });

  it('leaves a free-form box alone beyond clamping', () => {
    expect(fitCropToRatio({ x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, null)).toEqual({
      x: 0.2,
      y: 0.2,
      w: 0.6,
      h: 0.6,
    });
  });
});
