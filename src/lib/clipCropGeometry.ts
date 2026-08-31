/**
 * clipCropGeometry — the rectangle maths behind the clip editor's crop box.
 *
 * Pure and separate from the component because dragging a corner with a locked
 * aspect ratio, against a frame that is itself not square, is exactly the kind
 * of thing that looks right until an athlete drags past an edge. Everything
 * here works in *fractions of the displayed frame* (see `ClipCrop`), so the
 * same numbers describe the box on a phone preview and on the 4K source.
 */
import type { ClipCrop } from './videoClipEdit';

/** Smallest crop edge, as a fraction of the frame. Below this the box is
 *  impossible to grab back with a thumb, and the output is mush anyway. */
export const MIN_CROP_EDGE = 0.1;

export type CropHandle = 'nw' | 'ne' | 'sw' | 'se';

/**
 * Aspect presets, as output *pixel* ratios (width ÷ height).
 *
 * `null` is free-form. The set is deliberately short: portrait for a phone
 * filmed upright, square for a side-on snatch, and the two landscape ratios a
 * coach's screen actually is. COACH-CONFIG candidate.
 */
export const CROP_RATIOS: { label: string; ratio: number | null }[] = [
  { label: 'Free', ratio: null },
  { label: '9:16', ratio: 9 / 16 },
  { label: '1:1', ratio: 1 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '16:9', ratio: 16 / 9 },
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Convert an output pixel ratio into the width÷height a crop must have *in
 * fraction space*, given the frame's own aspect. A 1:1 crop of a 16:9 frame is
 * a tall sliver in fractions, not a square.
 */
export function ratioInFractionSpace(pixelRatio: number, frameAspect: number): number {
  return pixelRatio / frameAspect;
}

/** Push a rectangle back inside the frame, preserving its size where possible
 *  and its minimum edge always. */
export function clampCropToFrame(c: ClipCrop): ClipCrop {
  const w = Math.min(1, Math.max(MIN_CROP_EDGE, c.w));
  const h = Math.min(1, Math.max(MIN_CROP_EDGE, c.h));
  return {
    x: clamp01(Math.min(c.x, 1 - w)),
    y: clamp01(Math.min(c.y, 1 - h)),
    w,
    h,
  };
}

/** Translate the box, stopping at the frame edges rather than shrinking it. */
export function moveCrop(c: ClipCrop, dx: number, dy: number): ClipCrop {
  return {
    ...c,
    x: Math.min(1 - c.w, Math.max(0, c.x + dx)),
    y: Math.min(1 - c.h, Math.max(0, c.y + dy)),
  };
}

/**
 * Drag one corner to (px, py); the opposite corner stays put.
 *
 * With `fractionRatio` set the box keeps that width÷height: the dragged axis
 * with the larger travel drives, so the corner tracks the thumb rather than
 * fighting it, and the result is then clamped so the anchored corner never
 * moves and the box never leaves the frame.
 */
export function resizeCrop(
  c: ClipCrop,
  handle: CropHandle,
  px: number,
  py: number,
  fractionRatio: number | null,
): ClipCrop {
  const anchorX = handle === 'nw' || handle === 'sw' ? c.x + c.w : c.x;
  const anchorY = handle === 'nw' || handle === 'ne' ? c.y + c.h : c.y;
  const towardLeft = handle === 'nw' || handle === 'sw';
  const towardTop = handle === 'nw' || handle === 'ne';

  // How much room the box has to grow before it hits the frame edge.
  const maxW = towardLeft ? anchorX : 1 - anchorX;
  const maxH = towardTop ? anchorY : 1 - anchorY;

  let w = Math.abs(clamp01(px) - anchorX);
  let h = Math.abs(clamp01(py) - anchorY);

  if (fractionRatio != null) {
    // Floor both axes before any ratio maths: a corner dragged exactly onto
    // its anchor gives 0 × 0, and every scale factor derived from that is
    // Infinity or NaN.
    w = Math.max(w, MIN_CROP_EDGE);
    h = Math.max(h, MIN_CROP_EDGE);

    // Let the axis the thumb moved furthest along drive, then derive the other.
    if (w / fractionRatio >= h) h = w / fractionRatio;
    else w = h * fractionRatio;

    // Grow to the minimum edge, then shrink to the frame — both along the
    // ratio, so the box keeps its shape. Where the frame cannot hold the
    // minimum at this ratio, the clamp below wins and the ratio gives way.
    const grow = Math.max(1, MIN_CROP_EDGE / w, MIN_CROP_EDGE / h);
    w *= grow;
    h *= grow;
    const scale = Math.min(1, maxW / w, maxH / h);
    w *= scale;
    h *= scale;
  } else {
    w = Math.min(maxW, Math.max(MIN_CROP_EDGE, w));
    h = Math.min(maxH, Math.max(MIN_CROP_EDGE, h));
  }

  return clampCropToFrame({
    x: towardLeft ? anchorX - w : anchorX,
    y: towardTop ? anchorY - h : anchorY,
    w,
    h,
  });
}

/**
 * Re-shape a box to an aspect ratio, keeping its centre and staying inside the
 * frame — what tapping a preset chip should feel like.
 */
export function fitCropToRatio(c: ClipCrop, fractionRatio: number | null): ClipCrop {
  if (fractionRatio == null) return clampCropToFrame(c);

  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;

  // Start from the current box's area — the reshaped box should feel like the
  // same crop, not a reset.
  let w = Math.sqrt(c.w * c.h * fractionRatio);
  let h = w / fractionRatio;

  // Shrink to what fits *around the existing centre*, not merely to what fits
  // in the frame: clamping position instead would slide the box off the lifter
  // the athlete just centred.
  const scale = Math.min(1, (2 * Math.min(cx, 1 - cx)) / w, (2 * Math.min(cy, 1 - cy)) / h);
  w *= scale;
  h *= scale;

  return clampCropToFrame({ x: cx - w / 2, y: cy - h / 2, w, h });
}
