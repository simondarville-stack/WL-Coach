import { describe, it, expect } from 'vitest';
import {
  clampViewport,
  fitViewport,
  fullViewport,
  isFull,
  panViewport,
  spanOf,
  zoomViewport,
  MIN_SPAN,
  type Viewport,
} from '../chartViewport';

const vp = (start: number, end: number): Viewport => ({ start, end });

describe('clampViewport', () => {
  it('keeps a window that already fits', () => {
    expect(clampViewport(vp(2, 7), 20)).toEqual(vp(2, 7));
  });

  it('slides a window that runs off the end, preserving its span', () => {
    const c = clampViewport(vp(15, 24), 20);
    expect(c).toEqual(vp(10, 19));
    expect(spanOf(c)).toBe(10);
  });

  it('slides a window that runs off the start', () => {
    expect(clampViewport(vp(-5, 4), 20)).toEqual(vp(0, 9));
  });

  it('shrinks a window wider than the data', () => {
    expect(clampViewport(vp(0, 99), 5)).toEqual(vp(0, 4));
  });

  it('never goes below the minimum span', () => {
    expect(spanOf(clampViewport(vp(3, 3), 20))).toBe(MIN_SPAN);
  });

  it('handles empty data', () => {
    expect(clampViewport(vp(0, 5), 0)).toEqual(vp(0, 0));
  });
});

describe('zoomViewport', () => {
  it('zooming in narrows the window', () => {
    const z = zoomViewport(vp(0, 19), 20, 0.5);
    expect(spanOf(z)).toBe(10);
  });

  it('zooming out widens it', () => {
    const z = zoomViewport(vp(5, 14), 40, 2);
    expect(spanOf(z)).toBe(20);
  });

  it('keeps the data under the cursor in place', () => {
    // Anchor at the right edge: the last visible index must stay last.
    const z = zoomViewport(vp(0, 19), 100, 0.5, 1);
    expect(z.end).toBe(19);
    // Anchor at the left edge: the first stays first.
    const z2 = zoomViewport(vp(10, 29), 100, 0.5, 0);
    expect(z2.start).toBe(10);
  });

  it('zooming about the middle keeps the middle', () => {
    const z = zoomViewport(vp(0, 20), 100, 0.5, 0.5);
    const midBefore = (0 + 20) / 2;
    const midAfter = (z.start + z.end) / 2;
    expect(Math.abs(midAfter - midBefore)).toBeLessThanOrEqual(1);
  });

  it('cannot zoom out past the data', () => {
    const z = zoomViewport(vp(0, 9), 10, 5);
    expect(z).toEqual(vp(0, 9));
    expect(isFull(z, 10)).toBe(true);
  });

  it('cannot zoom in past the minimum span', () => {
    let z = vp(0, 19);
    for (let i = 0; i < 20; i++) z = zoomViewport(z, 20, 0.5);
    expect(spanOf(z)).toBe(MIN_SPAN);
  });

  it('clamps an out-of-range anchor fraction', () => {
    expect(() => zoomViewport(vp(0, 19), 20, 0.5, 5)).not.toThrow();
    const z = zoomViewport(vp(0, 19), 20, 0.5, 5);
    expect(z.start).toBeGreaterThanOrEqual(0);
    expect(z.end).toBeLessThanOrEqual(19);
  });
});

describe('panViewport', () => {
  it('slides by whole indices and preserves the span', () => {
    const p = panViewport(vp(5, 14), 40, 3);
    expect(p).toEqual(vp(8, 17));
    expect(spanOf(p)).toBe(10);
  });

  it('stops at the start', () => {
    expect(panViewport(vp(2, 11), 40, -50)).toEqual(vp(0, 9));
  });

  it('stops at the end', () => {
    expect(panViewport(vp(2, 11), 20, 50)).toEqual(vp(10, 19));
  });

  it('a full window cannot pan', () => {
    expect(panViewport(vp(0, 19), 20, 5)).toEqual(vp(0, 19));
  });
});

describe('fitViewport', () => {
  it('frames a span ending at the given index', () => {
    expect(fitViewport(100, 16, 60)).toEqual(vp(45, 60));
  });

  it('pushes the window right when the end is too early for the span', () => {
    expect(fitViewport(100, 16, 2)).toEqual(vp(0, 15));
  });

  it('clamps the end to the last index', () => {
    expect(fitViewport(20, 16, 500)).toEqual(vp(4, 19));
  });

  it('shows everything when the span exceeds the data', () => {
    expect(fitViewport(5, 50, 4)).toEqual(vp(0, 4));
  });
});

describe('fullViewport / isFull', () => {
  it('covers the whole range', () => {
    expect(fullViewport(20)).toEqual(vp(0, 19));
    expect(isFull(fullViewport(20), 20)).toBe(true);
  });

  it('a partial window is not full', () => {
    expect(isFull(vp(1, 18), 20)).toBe(false);
  });

  it('handles empty data', () => {
    expect(fullViewport(0)).toEqual(vp(0, 0));
  });
});

describe('round trips', () => {
  it('zoom in then out returns to a sane window inside the data', () => {
    const len = 60;
    let v: Viewport = fullViewport(len);
    for (let i = 0; i < 5; i++) v = zoomViewport(v, len, 0.8, 0.5);
    for (let i = 0; i < 20; i++) v = zoomViewport(v, len, 1.25, 0.5);
    expect(isFull(v, len)).toBe(true);
  });

  it('never produces an inverted or out-of-range window', () => {
    const len = 37;
    let v: Viewport = fitViewport(len, 16, 30);
    const ops: Array<() => void> = [
      () => { v = zoomViewport(v, len, 0.7, 0.2); },
      () => { v = zoomViewport(v, len, 1.4, 0.9); },
      () => { v = panViewport(v, len, -7); },
      () => { v = panViewport(v, len, 11); },
      () => { v = clampViewport(v, len); },
    ];
    for (let i = 0; i < 200; i++) {
      ops[i % ops.length]();
      expect(v.start).toBeGreaterThanOrEqual(0);
      expect(v.end).toBeLessThanOrEqual(len - 1);
      expect(v.end).toBeGreaterThanOrEqual(v.start);
      expect(Number.isInteger(v.start)).toBe(true);
      expect(Number.isInteger(v.end)).toBe(true);
    }
  });
});
