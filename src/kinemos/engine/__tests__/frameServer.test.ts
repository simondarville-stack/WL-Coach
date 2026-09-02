/**
 * The frame server's pure parts. Decoding itself needs WebCodecs and real
 * container bytes — neither exists in jsdom — so it is exercised in the running
 * app; what is tested here is the logic every frame lookup depends on.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  FrameCache,
  averageFpsOf,
  detectVfr,
  nearestIndexIn,
  prefetchOrder,
} from '../frameServer';

/** A constant-frame-rate timestamp table, as a phone recording at `fps` would
 *  produce if it never wavered. */
function cfr(count: number, fps: number, start = 0): number[] {
  return Array.from({ length: count }, (_, i) => start + i / fps);
}

describe('nearestIndexIn', () => {
  const ts = cfr(5, 10); // 0, 0.1, 0.2, 0.3, 0.4

  it('returns 0 for an empty table rather than -1', () => {
    // The viewer clamps to a frame; a -1 would paint nothing at all.
    expect(nearestIndexIn([], 1.23)).toBe(0);
  });

  it('clamps outside the clip', () => {
    expect(nearestIndexIn(ts, -5)).toBe(0);
    expect(nearestIndexIn(ts, 99)).toBe(4);
  });

  it('hits exact timestamps', () => {
    ts.forEach((t, i) => expect(nearestIndexIn(ts, t)).toBe(i));
  });

  it('rounds to the nearer frame', () => {
    expect(nearestIndexIn(ts, 0.104)).toBe(1);
    expect(nearestIndexIn(ts, 0.196)).toBe(2);
  });

  it('resolves a dead-centre scrub to the earlier frame', () => {
    // Stepping forward reaches the later frame, so neither is unreachable.
    expect(nearestIndexIn(ts, 0.15)).toBe(1);
  });

  it('handles a variable-rate table, where index/fps would not', () => {
    const vfr = [0, 0.04, 0.05, 0.2, 0.21];
    expect(nearestIndexIn(vfr, 0.19)).toBe(3);
    expect(nearestIndexIn(vfr, 0.06)).toBe(2);
  });
});

describe('detectVfr', () => {
  it('declines to judge a clip too short to tell', () => {
    expect(detectVfr(cfr(5, 60))).toBeNull();
  });

  it('reports constant frame rate as constant', () => {
    expect(detectVfr(cfr(120, 60))).toBe(false);
  });

  it('flags jittered timestamps', () => {
    // ±20 % jitter around a 60 fps nominal — an iPhone in poor light.
    const jittered = cfr(120, 60).map((t, i) => t + ((i % 3) - 1) * 0.004);
    expect(detectVfr(jittered)).toBe(true);
  });

  it('does not brand a clip variable over a single dropped frame', () => {
    const dropped = cfr(120, 60);
    dropped.splice(60, 1); // one gone; every other delta untouched
    expect(detectVfr(dropped)).toBe(false);
  });

  it('tolerates container-timescale rounding jitter', () => {
    // A 600-tick QuickTime timescale can only represent 59,94 fps as mostly
    // 10-tick deltas with an 11 slipped in — CFR in every way that matters.
    // This is the everyday iPhone clip; a rule that calls it VFR docks every
    // grade for nothing.
    const times = Array.from({ length: 120 }, (_, i) => Math.round((i / 59.94) * 600) / 600);
    expect(detectVfr(times)).toBe(false);
  });

  it('is not fooled by decode-order (B-frame) timestamps', () => {
    // The probe hands over packet order, not presentation order; sorted, the
    // stream is perfectly regular.
    const display = cfr(120, 59.94);
    const decodeOrder: number[] = [];
    for (let i = 0; i < display.length; i += 3) {
      decodeOrder.push(display[Math.min(i + 2, display.length - 1)]);
      if (display[i] !== undefined) decodeOrder.push(display[i]);
      if (display[i + 1] !== undefined) decodeOrder.push(display[i + 1]);
    }
    expect(detectVfr(decodeOrder)).toBe(false);
  });
});

describe('averageFpsOf', () => {
  it('recovers the nominal rate of a constant clip', () => {
    expect(averageFpsOf(cfr(61, 60))).toBeCloseTo(60, 6);
  });

  it('is zero when there is nothing to average', () => {
    expect(averageFpsOf([])).toBe(0);
    expect(averageFpsOf([1.5])).toBe(0);
  });
});

describe('prefetchOrder', () => {
  it('warms nearest first, forward before backward', () => {
    expect(prefetchOrder(10, 2, 100)).toEqual([11, 9, 12, 8]);
  });

  it('does not run off either end of the clip', () => {
    expect(prefetchOrder(0, 2, 3)).toEqual([1, 2]);
    expect(prefetchOrder(2, 2, 3)).toEqual([1, 0]);
  });
});

describe('FrameCache', () => {
  it('evicts least-recently-used and reports what it dropped', () => {
    const evicted: string[] = [];
    const cache = new FrameCache<string>(2, v => evicted.push(v));
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.set(3, 'c');
    expect(evicted).toEqual(['a']);
    expect(cache.keys()).toEqual([2, 3]);
  });

  it('a read renews a frame, so stepping back and forth does not thrash', () => {
    const cache = new FrameCache<string>(2);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.get(1); // coach steps back
    cache.set(3, 'c');
    expect(cache.has(1)).toBe(true);
    expect(cache.has(2)).toBe(false);
  });

  it('re-setting a key does not double-count against capacity', () => {
    const cache = new FrameCache<string>(2);
    cache.set(1, 'a');
    cache.set(1, 'a2');
    cache.set(2, 'b');
    expect(cache.size).toBe(2);
    expect(cache.get(1)).toBe('a2');
  });

  it('clear releases everything it holds', () => {
    const onEvict = vi.fn();
    const cache = new FrameCache<string>(4, onEvict);
    cache.set(1, 'a');
    cache.set(2, 'b');
    cache.clear();
    expect(onEvict).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(0);
  });
});
