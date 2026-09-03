/**
 * Edge chains on drawn masks: a rack upright, a shelf crossing it, a cable,
 * a plate rim. What comes out has to be the things that are straight in the
 * world and bent in the picture.
 */
import { describe, expect, it } from 'vitest';
import { chainSpanPx, selectPlumbLines, traceChains } from '../edgeChains';
import { distortPoint, distortionFor } from '../distortion';
import type { PxPoint } from '../calibration';

const W = 200;
const H = 300;

function blank(): Uint8Array {
  return new Uint8Array(W * H);
}

function plot(mask: Uint8Array, points: readonly PxPoint[]): void {
  for (const p of points) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1;
  }
}

function verticalLine(x: number, y0: number, y1: number): PxPoint[] {
  const out: PxPoint[] = [];
  for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
}

describe('traceChains', () => {
  it('finds a line and gets its length right', () => {
    const mask = blank();
    plot(mask, verticalLine(50, 20, 120));
    const chains = traceChains(mask, W, H);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toHaveLength(101);
    expect(chainSpanPx(chains[0])).toBeCloseTo(100, 6);
  });

  it('stops at a junction rather than guessing which arm continues', () => {
    // A shelf meeting an upright: the walk must not turn the corner and
    // report an L as one straight edge.
    const mask = blank();
    plot(mask, verticalLine(50, 20, 120));
    for (let x = 50; x <= 120; x++) plot(mask, [{ x, y: 70 }]);
    for (const chain of traceChains(mask, W, H)) {
      const xs = new Set(chain.map(p => p.x));
      const ys = new Set(chain.map(p => p.y));
      // A chain that turned the corner would vary in both directions.
      expect(xs.size === 1 || ys.size === 1).toBe(true);
    }
  });

  it('never offers a plate rim as a plumb line', () => {
    // A closed ring has no free end, so it is traced only by the sweep that
    // picks up what the first pass missed — and then thrown out for being
    // round, which is the check that matters.
    const mask = blank();
    const ring: PxPoint[] = [];
    for (let a = 0; a < 360; a += 2) {
      ring.push({ x: 100 + 30 * Math.cos((a * Math.PI) / 180), y: 150 + 30 * Math.sin((a * Math.PI) / 180) });
    }
    plot(mask, ring);
    expect(selectPlumbLines(traceChains(mask, W, H), W, H)).toHaveLength(0);
  });

  it('finds nothing in an empty frame', () => {
    expect(traceChains(blank(), W, H)).toHaveLength(0);
  });
});

describe('selectPlumbLines', () => {
  const model = distortionFor(W, H, -0.16);
  const bend = (points: PxPoint[]) => points.map(p => distortPoint(model, p));

  it('keeps a long bowed edge', () => {
    const mask = blank();
    plot(mask, bend(verticalLine(40, 20, 280)));
    const kept = selectPlumbLines(traceChains(mask, W, H), W, H);
    expect(kept).toHaveLength(1);
  });

  it('drops an edge too straight to say anything about the lens', () => {
    const mask = blank();
    plot(mask, verticalLine(40, 20, 280));
    expect(selectPlumbLines(traceChains(mask, W, H), W, H)).toHaveLength(0);
  });

  it('drops a curve — a cable is not a plumb line', () => {
    const mask = blank();
    const cable: PxPoint[] = [];
    for (let y = 20; y <= 280; y++) cable.push({ x: 40 + 25 * Math.sin(((y - 20) / 260) * Math.PI), y });
    plot(mask, cable);
    expect(selectPlumbLines(traceChains(mask, W, H), W, H)).toHaveLength(0);
  });

  it('drops a short edge', () => {
    const mask = blank();
    plot(mask, bend(verticalLine(40, 100, 120)));
    expect(selectPlumbLines(traceChains(mask, W, H), W, H)).toHaveLength(0);
  });

  it('returns the longest first and caps how many', () => {
    const mask = blank();
    plot(mask, bend(verticalLine(30, 10, 290)));
    plot(mask, bend(verticalLine(170, 20, 270)));
    plot(mask, bend(verticalLine(60, 40, 250)));
    const kept = selectPlumbLines(traceChains(mask, W, H), W, H, { limit: 2 });
    expect(kept).toHaveLength(2);
    expect(chainSpanPx(kept[0])).toBeGreaterThan(chainSpanPx(kept[1]));
  });

  it('drops an edge whose bow the pixel grid cannot resolve', () => {
    // Near the frame centre a barrel lens bends a line by well under a
    // pixel. Keeping it would add a chain that votes for k1 = 0 whatever
    // the lens actually is.
    const mask = blank();
    plot(mask, bend(verticalLine(95, 60, 200)));
    expect(selectPlumbLines(traceChains(mask, W, H), W, H)).toHaveLength(0);
  });
});
