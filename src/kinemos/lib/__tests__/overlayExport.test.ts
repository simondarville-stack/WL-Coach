import { describe, expect, it } from 'vitest';
import { positionAt } from '../overlayExport';

const track = [
  { t: 1.0, x: 100, y: 500 },
  { t: 1.1, x: 102, y: 480 },
  { t: 1.3, x: 106, y: 420 },
];

describe('positionAt', () => {
  it('is on a sample at its time and between two samples in between', () => {
    expect(positionAt(track, 1.1)).toEqual({ x: 102, y: 480 });
    const between = positionAt(track, 1.2)!;
    expect(between.x).toBeCloseTo(104, 6);
    expect(between.y).toBeCloseTo(450, 6);
  });

  it('is nowhere before the first sample and after the last', () => {
    expect(positionAt(track, 0.5)).toBeNull();
    expect(positionAt(track, 1.4)).toBeNull();
    expect(positionAt([], 1)).toBeNull();
  });

  it('sits on the last sample at its own time', () => {
    expect(positionAt(track, 1.3)).toEqual({ x: 106, y: 420 });
  });
});
