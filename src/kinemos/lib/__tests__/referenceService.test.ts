/**
 * One reference per (athlete, exercise) is a rule the database cannot state,
 * so it is tested where it is kept.
 */
import { describe, expect, it, vi } from 'vitest';
import type { KinemosLiftRecord } from '../analysisAdapter';
import { markAsReference, referenceOf } from '../referenceService';

vi.mock('../../../lib/supabase', () => ({ supabase: {} }));

function rep(over: Partial<KinemosLiftRecord> & { analysisId: string }): KinemosLiftRecord {
  return {
    clipKey: `direct:${over.analysisId}`,
    sourceKind: 'direct',
    sourceId: over.analysisId,
    repIndex: 1,
    label: null,
    athleteId: 'ath',
    athleteName: 'A',
    exerciseName: 'Snatch',
    date: '2026-08-01',
    loadKg: 80,
    massKg: 80,
    massSource: 'logged',
    grade: 'A',
    gradeErrorMs: 0.02,
    phaseSetId: 'default',
    isReference: false,
    isModel: false,
    modelLabel: null,
    schema: 1,
    analysedAt: '',
    values: { peakVelocity: 1.8 },
    ...over,
  };
}

describe('referenceOf', () => {
  const records = [
    rep({ analysisId: 'sn-ref', isReference: true }),
    rep({ analysisId: 'sn' }),
    rep({ analysisId: 'cl-ref', exerciseName: 'Clean', isReference: true }),
  ];

  it('finds the reference for the exercise, case-insensitively', () => {
    expect(referenceOf(records, 'snatch')?.analysisId).toBe('sn-ref');
    expect(referenceOf(records, 'Clean')?.analysisId).toBe('cl-ref');
  });

  it('is null for an exercise without one, or no exercise at all', () => {
    expect(referenceOf(records, 'Jerk')).toBeNull();
    expect(referenceOf(records, null)).toBeNull();
  });
});

describe('markAsReference', () => {
  it('clears the previous reference for the same athlete and exercise, then sets the new one', async () => {
    const load = vi.fn(async () => [
      rep({ analysisId: 'old', isReference: true }),
      rep({ analysisId: 'other-exercise', exerciseName: 'Clean', isReference: true }),
      rep({ analysisId: 'new' }),
    ]);
    const save = vi.fn(async () => undefined);
    await markAsReference({ analysisId: 'new', athleteId: 'ath', exerciseName: 'snatch' }, true, { load, save });
    expect(save.mock.calls).toEqual([
      ['old', { isReference: false }],
      ['new', { isReference: true }],
    ]);
    expect(load).toHaveBeenCalledWith({ athleteIds: ['ath'] });
  });

  it('unmarking touches only the rep itself', async () => {
    const load = vi.fn(async () => []);
    const save = vi.fn(async () => undefined);
    await markAsReference({ analysisId: 'x', athleteId: 'ath', exerciseName: 'Snatch' }, false, { load, save });
    expect(load).not.toHaveBeenCalled();
    expect(save.mock.calls).toEqual([['x', { isReference: false }]]);
  });

  it('sets a reference on a clip with no athlete without looking for rivals', async () => {
    const load = vi.fn(async () => []);
    const save = vi.fn(async () => undefined);
    await markAsReference({ analysisId: 'x', athleteId: null, exerciseName: 'Snatch' }, true, { load, save });
    expect(load).not.toHaveBeenCalled();
    expect(save.mock.calls).toEqual([['x', { isReference: true }]]);
  });
});
