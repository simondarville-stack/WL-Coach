/**
 * The VFR call feeds `kinemos_videos.vfr`, which the P2 engine uses to decide
 * whether nominal fps can be trusted for dx/dt. A false negative quietly
 * corrupts velocities; a false positive needlessly docks the quality grade —
 * so both directions get pinned here.
 */
import { describe, expect, it } from 'vitest';
import { isVariableFrameRate } from '../kinemosProbe';

/** n timestamps at a constant interval, like a tripod 59.94 fps recording. */
const cfr = (n: number, dt = 1 / 59.94) => Array.from({ length: n }, (_, i) => i * dt);

describe('isVariableFrameRate', () => {
  it('calls a constant-rate clip CFR', () => {
    expect(isVariableFrameRate(cfr(120))).toBe(false);
  });

  it('tolerates container-timescale rounding jitter', () => {
    // A 600-tick QuickTime timescale can only represent 59.94 fps as mostly
    // 10-tick deltas with an 11 slipped in — CFR in every way that matters.
    const times = Array.from({ length: 120 }, (_, i) => Math.round((i / 59.94) * 600) / 600);
    expect(isVariableFrameRate(times)).toBe(false);
  });

  it('calls real VFR — frame intervals swinging with exposure — VFR', () => {
    // Low-light phone VFR: intervals wandering between ~1/24 and ~1/60.
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 120; i++) {
      times.push(t);
      t += i % 3 === 0 ? 1 / 24 : 1 / 60;
    }
    expect(isVariableFrameRate(times)).toBe(true);
  });

  it('is not fooled by decode-order (B-frame) timestamps', () => {
    // Presentation timestamps arrive out of order from a B-frame stream;
    // sorted, they are perfectly regular.
    const display = cfr(120);
    const decodeOrder: number[] = [];
    for (let i = 0; i < display.length; i += 3) {
      // I/P first, then the two B-frames that present before it.
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
