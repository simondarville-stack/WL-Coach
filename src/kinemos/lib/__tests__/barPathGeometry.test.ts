/**
 * A centimetre sideways is as long as a centimetre up — unless the coach
 * asks for the horizontal to be exaggerated, and then it is exactly that
 * many times longer, with the ticks still in real centimetres.
 */
import { describe, expect, it } from 'vitest';
import type { KinematicSeries } from '../../engine/kinematics';
import { BASE, TOP, barPathGeometry } from '../barPathGeometry';

function series(): KinematicSeries {
  const n = 50;
  const t = Array.from({ length: n }, (_, i) => i * 0.02);
  const yCm = t.map(s => s * 100);
  const xCm = t.map(s => 6 * Math.sin(s * 3));
  const vyMs = t.map(s => 1.5 * Math.sin(s * 3));
  return { t, xCm, yCm, vyMs } as unknown as KinematicSeries;
}

describe('barPathGeometry', () => {
  it('draws the bar path 1:1 with the height axis', () => {
    const g = barPathGeometry(series(), 1);
    const dy = g.yOf(0) - g.yOf(10);
    const dx = g.xOfPath(10) - g.xOfPath(0);
    expect(dx).toBeCloseTo(dy, 6);
    expect(dx).toBeCloseTo(10 * g.unitsPerCm, 6);
  });

  it('exaggerates only the horizontal, by the factor', () => {
    const plain = barPathGeometry(series(), 1);
    const wide = barPathGeometry(series(), 4);
    expect(wide.xOfPath(5) - wide.xOfPath(0)).toBeCloseTo(4 * (plain.xOfPath(5) - plain.xOfPath(0)), 6);
    expect(wide.yOf(50)).toBe(plain.yOf(50));
  });

  it('spaces the tick labels by the plot, not the loop, at every scale', () => {
    for (const factor of [1, 2, 4] as const) {
      const g = barPathGeometry(series(), factor);
      const [minus, zero, plus] = g.pathTicks;
      expect(zero).toBe(0);
      expect(plus).toBe(-minus);
      expect(g.xOfPath(plus) - g.xOfPath(0)).toBeGreaterThanOrEqual(24);
    }
    // Coarser at 1:1, finer when exaggerated — always real centimetres.
    expect(barPathGeometry(series(), 1).pathTicks[2]).toBeGreaterThan(barPathGeometry(series(), 4).pathTicks[2]);
  });

  it('keeps the height axis inside the plot and the origin centred', () => {
    const g = barPathGeometry(series(), 2);
    expect(g.yOf(0)).toBeLessThanOrEqual(BASE);
    expect(g.yOf(98)).toBeGreaterThanOrEqual(TOP);
    expect(g.pathZeroX).toBe(80);
    expect(g.pathTicks).toEqual([-5, 0, 5]);
  });

  it('gives velocity its own scale with zero inside it', () => {
    const g = barPathGeometry(series(), 1);
    expect(g.velocityZeroX).toBeGreaterThan(24);
    expect(g.velocityZeroX).toBeLessThan(136);
    expect(g.velocityTicks).toContain(0);
  });
});
