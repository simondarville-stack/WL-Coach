/**
 * Frame-accuracy lives or dies here. Every "the coach stepped one frame and
 * the number jumped two" bug is a bug in this arithmetic, so the index, the
 * seek and the VFR judgement are all pinned.
 */
import { describe, expect, it } from 'vitest';
import {
  averageFrameRate,
  buildFrameIndex,
  clampFrameIndex,
  frameIndexAtTime,
  isVariableFrameRate,
} from '../frameTiming';

/** n frames at a constant interval — a tripod 60 fps recording. */
const cfr = (n: number, dt = 1 / 60) => Array.from({ length: n }, (_, i) => i * dt);

describe('buildFrameIndex', () => {
  it('puts decode-order (B-frame) timestamps back into presentation order', () => {
    // A classic IBBP pattern: the P-frame decodes before the B-frames that
    // present ahead of it.
    const decodeOrder = [0, 3 / 60, 1 / 60, 2 / 60, 6 / 60, 4 / 60, 5 / 60];
    const index = buildFrameIndex(decodeOrder);
    expect(index.length).toBe(7);
    expect([...index.timestamps]).toEqual([...index.timestamps].sort((a, b) => a - b));
    expect(index.timestamps[1]).toBeCloseTo(1 / 60, 10);
  });

  it('drops duplicate presentation timestamps', () => {
    // A duplicate is not a frame the coach can step to; leaving it in makes
    // "next frame" a no-op that reads as a frozen viewer.
    const index = buildFrameIndex([0, 1 / 60, 1 / 60, 2 / 60]);
    expect(index.length).toBe(3);
  });

  it('fills a missing duration from the gap to the next frame', () => {
    const index = buildFrameIndex([0, 0.5, 1.0], [0, 0, 0]);
    expect(index.durations[0]).toBeCloseTo(0.5, 10);
    expect(index.durations[1]).toBeCloseTo(0.5, 10);
    // The last frame has no successor, so it borrows the median gap.
    expect(index.durations[2]).toBeCloseTo(0.5, 10);
  });

  it('keeps real durations where the container supplied them', () => {
    const index = buildFrameIndex([0, 0.5], [0.4, 0.6]);
    expect(index.durations[0]).toBeCloseTo(0.4, 10);
    expect(index.endTime).toBeCloseTo(1.1, 10);
  });

  it('ignores non-finite timestamps rather than poisoning the index', () => {
    const index = buildFrameIndex([0, Number.NaN, 1 / 60, Infinity]);
    expect(index.length).toBe(2);
  });

  it('survives an empty clip', () => {
    const index = buildFrameIndex([]);
    expect(index.length).toBe(0);
    expect(index.endTime).toBe(0);
  });
});

describe('frameIndexAtTime', () => {
  const index = buildFrameIndex(cfr(120));

  it('returns the frame on screen: the last one at or before the time', () => {
    expect(frameIndexAtTime(index, 0)).toBe(0);
    expect(frameIndexAtTime(index, 10 / 60)).toBe(10);
    // Mid-frame stays on the frame being displayed, it does not round up.
    expect(frameIndexAtTime(index, 10.9 / 60)).toBe(10);
  });

  it('is exact on every frame boundary — no off-by-one drift down the clip', () => {
    for (let i = 0; i < index.length; i++) {
      expect(frameIndexAtTime(index, index.timestamps[i])).toBe(i);
    }
  });

  it('clamps outside the clip instead of returning a negative index', () => {
    expect(frameIndexAtTime(index, -5)).toBe(0);
    expect(frameIndexAtTime(index, 9999)).toBe(index.length - 1);
    expect(frameIndexAtTime(index, Number.NaN)).toBe(0);
  });

  it('lands on the right frame in variable-rate footage', () => {
    // Uneven on purpose: an index built on a nominal fps would miss here.
    const vfr = buildFrameIndex([0, 0.1, 0.5, 0.55, 1.2]);
    expect(frameIndexAtTime(vfr, 0.4)).toBe(1);
    expect(frameIndexAtTime(vfr, 0.54)).toBe(2);
    expect(frameIndexAtTime(vfr, 1.19)).toBe(3);
    expect(frameIndexAtTime(vfr, 1.2)).toBe(4);
  });
});

describe('clampFrameIndex', () => {
  const index = buildFrameIndex(cfr(10));

  it('stops at the ends rather than wrapping', () => {
    expect(clampFrameIndex(index, -3)).toBe(0);
    expect(clampFrameIndex(index, 99)).toBe(9);
  });

  it('truncates a fractional index', () => {
    expect(clampFrameIndex(index, 4.9)).toBe(4);
  });
});

describe('averageFrameRate', () => {
  it('measures the real rate rather than trusting a declared one', () => {
    expect(averageFrameRate(buildFrameIndex(cfr(61)))).toBeCloseTo(60, 6);
    expect(averageFrameRate(buildFrameIndex(cfr(31, 1 / 30)))).toBeCloseTo(30, 6);
  });

  it('has no answer for a single frame', () => {
    expect(averageFrameRate(buildFrameIndex([0]))).toBeNull();
  });
});

describe('isVariableFrameRate', () => {
  it('calls a constant-rate clip CFR', () => {
    expect(isVariableFrameRate(cfr(120, 1 / 59.94))).toBe(false);
  });

  it('tolerates container-timescale rounding jitter', () => {
    // A 600-tick QuickTime timescale can only represent 59,94 fps as mostly
    // 10-tick gaps with an 11 slipped in — CFR in every way that matters.
    const times = Array.from({ length: 120 }, (_, i) => Math.round((i / 59.94) * 600) / 600);
    expect(isVariableFrameRate(times)).toBe(false);
  });

  it('calls real VFR — intervals swinging with exposure — VFR', () => {
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      times.push(t);
      t += i % 3 === 0 ? 1 / 24 : 1 / 60;
    }
    expect(isVariableFrameRate(times)).toBe(true);
  });

  it('is not fooled by decode-order timestamps', () => {
    const display = cfr(120, 1 / 59.94);
    const decodeOrder: number[] = [];
    for (let i = 0; i < display.length; i += 3) {
      decodeOrder.push(display[Math.min(i + 2, display.length - 1)]);
      if (display[i] !== undefined) decodeOrder.push(display[i]);
      if (display[i + 1] !== undefined) decodeOrder.push(display[i + 1]);
    }
    expect(isVariableFrameRate(decodeOrder)).toBe(false);
  });

  it('refuses to judge a sample too small to mean anything', () => {
    expect(isVariableFrameRate(cfr(10))).toBeNull();
    expect(isVariableFrameRate([])).toBeNull();
  });
});
