/**
 * chartViewport — index-window maths for a zoomable / pannable category chart.
 *
 * Recharts' category axis has no zoom of its own, and fighting its internal
 * scales is a losing game. Instead we hold an inclusive `[start, end]` index
 * window in React state and hand the chart `data.slice(start, end + 1)`. That
 * is exact on a category axis, and leaves tooltips, dots and reference lines
 * working untouched.
 *
 * Pure and framework-free so the arithmetic — which is where the off-by-ones
 * live — can be unit-tested without rendering anything.
 */

export interface Viewport {
  /** First visible index, inclusive. */
  start: number;
  /** Last visible index, inclusive. */
  end: number;
}

/** Fewest points a window may show. Below ~3 a line chart stops being one. */
export const MIN_SPAN = 3;

export const spanOf = (vp: Viewport): number => vp.end - vp.start + 1;

const clampInt = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : Math.round(v);

/** Force a window inside `[0, len - 1]`, preserving its span where possible. */
export function clampViewport(vp: Viewport, len: number, minSpan = MIN_SPAN): Viewport {
  if (len <= 0) return { start: 0, end: 0 };
  const maxSpan = len;
  const span = clampInt(spanOf(vp), Math.min(minSpan, maxSpan), maxSpan);
  let start = clampInt(vp.start, 0, Math.max(0, len - span));
  const end = start + span - 1;
  if (end > len - 1) start = len - span;
  return { start, end: start + span - 1 };
}

/**
 * Zoom about a point in the window.
 *
 * `factor < 1` zooms in, `> 1` zooms out. `anchorFraction` is 0…1 across the
 * window — the position under the cursor — so the data under the pointer stays
 * put, which is what makes wheel-zoom feel right.
 */
export function zoomViewport(
  vp: Viewport,
  len: number,
  factor: number,
  anchorFraction = 0.5,
  minSpan = MIN_SPAN,
): Viewport {
  if (len <= 0) return { start: 0, end: 0 };
  const span = spanOf(vp);
  const nextSpan = clampInt(span * factor, Math.min(minSpan, len), len);
  const a = anchorFraction < 0 ? 0 : anchorFraction > 1 ? 1 : anchorFraction;
  const anchorIdx = vp.start + a * (span - 1);
  const start = Math.round(anchorIdx - a * (nextSpan - 1));
  return clampViewport({ start, end: start + nextSpan - 1 }, len, minSpan);
}

/** Slide the window by whole indices, keeping its span and stopping at the ends. */
export function panViewport(vp: Viewport, len: number, deltaIndices: number): Viewport {
  if (len <= 0) return { start: 0, end: 0 };
  const span = spanOf(vp);
  const start = clampInt(vp.start + deltaIndices, 0, Math.max(0, len - span));
  return { start, end: start + span - 1 };
}

/**
 * A window of `span` points ending at (or before) `endAt` — how the chart is
 * framed on first load, so the week being planned sits near the right edge with
 * the recent past behind it.
 */
export function fitViewport(len: number, span: number, endAt: number): Viewport {
  if (len <= 0) return { start: 0, end: 0 };
  const s = clampInt(span, Math.min(MIN_SPAN, len), len);
  const end = clampInt(endAt, s - 1, len - 1);
  return { start: end - s + 1, end };
}

/** The window covering everything. */
export const fullViewport = (len: number): Viewport => ({ start: 0, end: Math.max(0, len - 1) });

export const isFull = (vp: Viewport, len: number): boolean =>
  vp.start <= 0 && vp.end >= len - 1;
