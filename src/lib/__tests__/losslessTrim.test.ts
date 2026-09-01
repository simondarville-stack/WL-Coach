/**
 * The snap is what makes the lossless trim honest: the editor's start handle
 * must land exactly where the packet copy will cut, or the coach sees one
 * clip and gets another.
 */
import { describe, expect, it } from 'vitest';
import { snapToKeyframe } from '../losslessTrim';

// A typical phone GOP: a keyframe every ~2 s.
const KEYFRAMES = [0, 2.002, 4.004, 6.006, 8.008];

describe('snapToKeyframe', () => {
  it('snaps down to the keyframe at or before the requested start', () => {
    expect(snapToKeyframe(KEYFRAMES, 5)).toBe(4.004);
    expect(snapToKeyframe(KEYFRAMES, 2.5)).toBe(2.002);
    expect(snapToKeyframe(KEYFRAMES, 0.4)).toBe(0);
  });

  it('holds a handle parked on a keyframe there despite float noise', () => {
    // A hair under the keyframe — within half a frame — stays on it rather
    // than slipping back a whole GOP.
    expect(snapToKeyframe(KEYFRAMES, 4.004 - 0.004)).toBe(4.004);
    expect(snapToKeyframe(KEYFRAMES, 4.004)).toBe(4.004);
  });

  it('is exact past the last keyframe', () => {
    expect(snapToKeyframe(KEYFRAMES, 100)).toBe(8.008);
  });

  it('answers the first keyframe for a start before any keyframe', () => {
    expect(snapToKeyframe([1.5, 3.5], 0.2)).toBe(1.5);
  });

  it('leaves the start alone when no keyframes are known', () => {
    expect(snapToKeyframe([], 3.3)).toBe(3.3);
  });
});
