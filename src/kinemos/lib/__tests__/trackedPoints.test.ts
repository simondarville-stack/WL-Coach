/**
 * A stored point keeps the tracker's score; the strip and the flagged list
 * are read back from it, by the tracker's own thresholds.
 */
import { describe, expect, it } from 'vitest';
import type { KinemosTrackPoint } from '../../../lib/database.types';
import { CONFIDENCE_FLAGGED, CONFIDENCE_SOLID, bandOf, confidenceRuns, frameConfidences, lowConfidenceFrames, toTrackPoint } from '../trackedPoints';

// Frames are 0,04 s apart; the index is the time in frames.
const nearestIndex = (t: number) => Math.round(t / 0.04);
const at = (index: number, c?: number, s: 'm' | 't' = 't'): KinemosTrackPoint => ({ t: index * 0.04, x: 0, y: 0, s, ...(c === undefined ? {} : { c }) });

describe('toTrackPoint', () => {
  it('keeps the score to two decimals and marks the point as tracked', () => {
    expect(toTrackPoint({ index: 3, t: 0.12, x: 1, y: 2, confidence: 0.86749, predictionErrorPx: 0 })).toEqual({
      t: 0.12,
      x: 1,
      y: 2,
      s: 't',
      c: 0.87,
    });
  });
});

describe('bandOf', () => {
  it('follows the tracker’s thresholds, and a hand mark has no score', () => {
    expect(bandOf({ s: 't', c: CONFIDENCE_SOLID })).toBe('solid');
    expect(bandOf({ s: 't', c: 0.7 })).toBe('doubtful');
    expect(bandOf({ s: 't', c: CONFIDENCE_FLAGGED - 0.01 })).toBe('flagged');
    expect(bandOf({ s: 't' })).toBe('unscored');
    expect(bandOf({ s: 'm', c: 0.2 })).toBe('manual');
  });
});

describe('frameConfidences / lowConfidenceFrames', () => {
  it('places each point on its frame, the corrected one winning, in order', () => {
    const frames = frameConfidences([at(2, 0.9), at(0, 0.4), at(2, undefined, 'm')], nearestIndex);
    expect(frames).toEqual([
      { index: 0, c: 0.4, band: 'flagged' },
      { index: 2, c: null, band: 'manual' },
    ]);
  });

  it('rebuilds the flagged list from stored scores, and leaves out a point it cannot place', () => {
    const points = [at(0, 0.9), at(1, 0.5), at(2, 0.3), at(3)];
    expect(lowConfidenceFrames(points, nearestIndex)).toEqual([1, 2]);
    expect(frameConfidences(points, () => Number.NaN)).toEqual([]);
  });
});

describe('confidenceRuns', () => {
  it('groups frames into runs of one band, with the gaps as none, over the whole clip', () => {
    const frames = frameConfidences([at(1, 0.9), at(2, 0.85), at(3, 0.5), at(4, undefined, 'm'), at(5, 0.95)], nearestIndex);
    expect(confidenceRuns(frames, 8)).toEqual([
      { from: 0, to: 0, band: 'none', c: null },
      { from: 1, to: 2, band: 'solid', c: expect.closeTo(0.875, 6) },
      { from: 3, to: 3, band: 'flagged', c: 0.5 },
      { from: 4, to: 4, band: 'manual', c: null },
      { from: 5, to: 5, band: 'solid', c: 0.95 },
      { from: 6, to: 7, band: 'none', c: null },
    ]);
  });

  it('is one empty run for a clip with no points, and ignores frames past the end', () => {
    expect(confidenceRuns([], 4)).toEqual([{ from: 0, to: 3, band: 'none', c: null }]);
    expect(confidenceRuns(frameConfidences([at(9, 0.9)], nearestIndex), 4)).toEqual([{ from: 0, to: 3, band: 'none', c: null }]);
  });
});
