import { describe, expect, it } from 'vitest';
import {
  aspectMatches,
  checkEditedClip,
  CROP_IGNORED_FRACTION,
  CROP_MIN_EVIDENCE,
  judgeCrop,
  meanAbsDiff,
  toLuma,
} from '../clipGeometryCheck';
import type { ClipEdit } from '../videoClipEdit';

describe('aspectMatches', () => {
  it('accepts the exact size and encoder padding of a row or two', () => {
    expect(aspectMatches({ width: 1080, height: 1920 }, { width: 1080, height: 1920 })).toBe(true);
    expect(aspectMatches({ width: 1080, height: 1936 }, { width: 1080, height: 1920 })).toBe(true);
    expect(aspectMatches({ width: 1088, height: 1920 }, { width: 1080, height: 1920 })).toBe(true);
  });

  it('rejects the squeeze that was uploaded: a 9:16 lift declared 1080×1344', () => {
    expect(aspectMatches({ width: 1080, height: 1344 }, { width: 1080, height: 1920 })).toBe(false);
  });

  it('rejects a rotation that went missing', () => {
    expect(aspectMatches({ width: 1920, height: 1080 }, { width: 1080, height: 1920 })).toBe(false);
  });

  it('never accepts a degenerate size', () => {
    expect(aspectMatches({ width: 0, height: 0 }, { width: 1080, height: 1920 })).toBe(false);
  });
});

describe('judgeCrop', () => {
  it('passes an output that matches its crop', () => {
    expect(judgeCrop({ cropDiff: 4, fullDiff: 31, refDiff: 30 })).toBe('ok');
  });

  it('flags an output that matches the squeezed whole frame instead', () => {
    expect(judgeCrop({ cropDiff: 31, fullDiff: 4, refDiff: 30 })).toBe('crop-ignored');
  });

  it('scales with the frame: a bland scene is judged on its own small separation', () => {
    // The synthetic probe scene — grey, one circle, four corner squares — sits
    // about here; the failure it exists to catch must still be caught.
    expect(judgeCrop({ cropDiff: 4.7, fullDiff: 0.6, refDiff: 4.7 })).toBe('crop-ignored');
    expect(judgeCrop({ cropDiff: 0.6, fullDiff: 4.7, refDiff: 4.7 })).toBe('ok');
  });

  it('stays quiet on a uniform frame, where there is no evidence either way', () => {
    expect(judgeCrop({ cropDiff: 1, fullDiff: 0, refDiff: CROP_MIN_EVIDENCE - 0.5 })).toBe('ok');
  });

  it('needs a clear lean, not a coin toss between two poor matches', () => {
    // Codec noise and a frame of drift raise both distances together.
    const ref = 20;
    expect(judgeCrop({ cropDiff: 40, fullDiff: 40 - CROP_IGNORED_FRACTION * ref, refDiff: ref })).toBe('ok');
    expect(judgeCrop({ cropDiff: 40, fullDiff: 40 - CROP_IGNORED_FRACTION * ref - 1, refDiff: ref })).toBe(
      'crop-ignored',
    );
  });
});

describe('luma distance', () => {
  it('reads luma out of RGBA and measures a mean absolute gap', () => {
    const black = toLuma(new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]));
    const white = toLuma(new Uint8ClampedArray([255, 255, 255, 255, 255, 255, 255, 255]));
    expect(meanAbsDiff(black, black)).toBe(0);
    expect(meanAbsDiff(black, white)).toBeCloseTo(255, 0);
    expect(meanAbsDiff(new Float32Array(0), new Float32Array(0))).toBe(0);
  });
});

describe('checkEditedClip', () => {
  const edit: ClipEdit = { start: 0, end: 2, crop: { x: 0, y: 0.15, w: 1, h: 0.7 }, maxEdge: null };
  const file = () => new File([new Uint8Array(8)], 'clip.mp4', { type: 'video/mp4' });

  it('passes as unchecked where no frame can be read, rather than blocking the athlete', async () => {
    // jsdom decodes nothing: metadata never arrives, so the check times out.
    const verdict = await checkEditedClip(file(), file(), edit, { timeoutMs: 30 });
    expect(verdict).toEqual({ ok: true, checked: false });
  });
});
