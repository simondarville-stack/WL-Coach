/**
 * The verdict is derived from the delta against the grade's margin, never
 * from the sign alone: a difference inside the margin is "level with", and a
 * directional claim is only made when the difference clears it.
 */
import { describe, expect, it } from 'vitest';
import type { KinemosAnalysis } from '../../../lib/database.types';
import type { StoredMetrics } from '../../engine/metricCatalogue';
import type { ComparisonCandidate } from '../comparisonService';
import type { LibraryVideo } from '../videoLibrary';
import { findEarlierLift, verdictFor } from '../verdict';

function clip(overrides: Partial<LibraryVideo>): LibraryVideo {
  return {
    key: 'direct:x',
    source: 'direct',
    sourceId: 'x',
    athleteId: 'a-1',
    athleteName: 'Rasmus L.',
    exerciseName: 'Snatch',
    date: '2026-08-19',
    sortedAt: '2026-08-19T10:00:00Z',
    loadKg: 112.5,
    loadIsTopSet: false,
    durationS: 5,
    fps: 60,
    width: 1080,
    height: 1920,
    deviceMake: null,
    deviceModel: null,
    playbackUrl: '',
    isEmbed: false,
    thumbnailUrl: null,
    note: null,
    sessionId: null,
    eventId: null,
    ...overrides,
  };
}

function candidate(
  id: string,
  date: string,
  loadKg: number,
  vmax: number,
  extra: Partial<ComparisonCandidate> = {},
  errorMs: number | null = 0.02,
): ComparisonCandidate {
  const analysis = {
    id,
    metrics: { phases: [], peakVelocityMs: vmax, analyzer: { vmaxMs: vmax } },
    grade: 'A',
    grade_error_ms: errorMs,
    is_reference: false,
    is_model: false,
    model_label: null,
  } as unknown as KinemosAnalysis;
  return {
    analysis,
    clip: clip({ date, loadKg, sourceId: id, key: `direct:${id}` }),
    sameExercise: true,
    isReference: false,
    isModel: false,
    modelLabel: null,
    ...extra,
  };
}

describe('findEarlierLift', () => {
  const current = { date: '2026-08-26', loadKg: 112.5 };

  it('prefers the most recent earlier lift at the same load', () => {
    const found = findEarlierLift(
      [
        candidate('old-same', '2026-07-22', 112.5, 1.78),
        candidate('newer-other', '2026-08-19', 110, 1.8),
        candidate('older-same', '2026-07-01', 112.5, 1.7),
      ],
      current,
    );
    expect(found?.analysisId).toBe('old-same');
    // The whole cache column comes along, for the per-metric deltas.
    expect(found?.metrics.analyzer.vmaxMs).toBe(1.78);
  });

  it('falls back to the latest lift at any load, and says which', () => {
    const found = findEarlierLift([candidate('other', '2026-08-19', 110, 1.8)], current);
    expect(found?.analysisId).toBe('other');
    expect(found?.loadKg).toBe(110);
  });

  it('never picks a model lift, a later lift, another exercise, or a row without a peak', () => {
    const found = findEarlierLift(
      [
        candidate('model', '2026-08-01', 112.5, 1.9, { isModel: true }),
        candidate('later', '2026-09-01', 112.5, 1.9),
        candidate('other-lift', '2026-08-01', 112.5, 1.9, { sameExercise: false }),
        { ...candidate('no-metrics', '2026-08-01', 112.5, 1.9), analysis: { ...candidate('x', '', 0, 0).analysis, metrics: null } },
      ],
      current,
    );
    expect(found).toBeNull();
  });
});

describe('verdictFor', () => {
  const earlier = {
    analysisId: 'e',
    date: '2026-07-22',
    loadKg: 112.5,
    peakVelocityMs: 1.78,
    errorMs: 0.02,
    metrics: { schema: 2, phases: [], peakVelocityMs: 1.78, summary: null } as unknown as StoredMetrics,
  };

  it('reports a difference larger than the margin as real, with its direction', () => {
    const v = verdictFor({ peakVelocityMs: 1.82, loadKg: 112.5, errorMs: 0.02 }, earlier);
    expect(v.kind).toBe('faster');
    expect(v.headline).toBe('Faster than the last lift at this weight');
    expect(v.detail).toContain('+0,04 m/s vs 22/07');
    expect(v.detail).toContain('larger than the ±0,02 m/s margin');
  });

  it('reports a difference inside the margin as level — never a directional claim', () => {
    const v = verdictFor({ peakVelocityMs: 1.79, loadKg: 112.5, errorMs: 0.02 }, earlier);
    expect(v.kind).toBe('level');
    expect(v.headline).toBe('Level with the last lift at this weight');
    expect(v.detail).toContain('+0,01 m/s');
    expect(v.detail).toContain('inside the ±0,02 m/s margin');
  });

  it('is gated by the wider of the two margins', () => {
    // This lift is graded tight, the earlier one loosely: +0,04 does not
    // clear the earlier lift's ±0,05.
    const v = verdictFor({ peakVelocityMs: 1.82, loadKg: 112.5, errorMs: 0.01 }, { ...earlier, errorMs: 0.05 });
    expect(v.kind).toBe('level');
    expect(v.detail).toContain('±0,05 m/s');
  });

  it('says slower with a typographic minus', () => {
    const v = verdictFor({ peakVelocityMs: 1.7, loadKg: 112.5, errorMs: 0.02 }, earlier);
    expect(v.kind).toBe('slower');
    expect(v.detail).toContain('−0,08 m/s');
  });

  it('names the load when the earlier lift was at a different one', () => {
    const v = verdictFor({ peakVelocityMs: 1.9, loadKg: 112.5, errorMs: 0.02 }, { ...earlier, loadKg: 110 });
    expect(v.headline).toBe('Faster than the last lift at 110 kg');
  });

  it('has nothing to say without a peak, or without an earlier lift', () => {
    expect(verdictFor({ peakVelocityMs: null, loadKg: 112.5, errorMs: null }, earlier).kind).toBe('none');
    const none = verdictFor({ peakVelocityMs: 1.8, loadKg: 112.5, errorMs: 0.02 }, null);
    expect(none.kind).toBe('none');
    expect(none.detail).toContain('112,5 kg');
  });
});
