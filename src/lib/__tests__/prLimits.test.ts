import { describe, it, expect } from 'vitest';
import {
  buildPRLimits,
  checkLineBeyondPR,
  checkPrescriptionBeyondPR,
  describePRVerdict,
  prThresholdAt,
  type PRLimit,
} from '../prLimits';
import type { AthletePR, AthletePRHistory } from '../database.types';

const hist = (exercise_id: string, rep_count: number, value_kg: number, achieved_date = '2026-09-01'): AthletePRHistory => ({
  id: `${exercise_id}-${rep_count}-${value_kg}`, athlete_id: 'a', exercise_id, rep_count, value_kg, achieved_date,
  notes: null, created_at: `${achieved_date}T10:00:00Z`,
});
const cache = (exercise_id: string, pr_value_kg: number): AthletePR => ({
  id: `c-${exercise_id}`, athlete_id: 'a', exercise_id, pr_value_kg, pr_date: '2026-09-01', notes: null,
  created_at: '', updated_at: '',
});
const names: Record<string, string> = { sn: 'Snatch', cl: 'Clean', jk: 'Jerk' };
const nameOf = (id: string) => names[id] ?? id;

describe('buildPRLimits', () => {
  it('takes the newest entry per rep count and the cached 1RM', () => {
    const limits = buildPRLimits(
      [hist('sn', 1, 100, '2026-09-01'), hist('sn', 1, 95, '2026-08-01'), hist('sn', 3, 90)],
      [cache('sn', 101)],
      nameOf,
    );
    const sn = limits.get('sn')!;
    expect(sn.real.get(1)).toBe(100);
    expect(sn.real.get(3)).toBe(90);
    expect(sn.oneRM).toBe(101);
    expect(sn.name).toBe('Snatch');
  });

  it('blends a 1RM from the anchors when the cache row is missing', () => {
    const sn = buildPRLimits([hist('sn', 1, 100)], [], nameOf).get('sn')!;
    expect(sn.oneRM).toBe(100);
  });

  it('knows an exercise that only has a cache row', () => {
    const sn = buildPRLimits([], [cache('sn', 100)], nameOf).get('sn')!;
    expect(sn.oneRM).toBe(100);
    expect(sn.anchors).toHaveLength(0);
  });
});

describe('prThresholdAt', () => {
  const sn: PRLimit = {
    real: new Map([[1, 100]]), anchors: [{ reps: 1, valueKg: 100 }], oneRM: 100, name: 'Snatch',
  };
  it('is the real entry where one exists', () => {
    expect(prThresholdAt(sn, 1)).toEqual({ kg: 100, estimated: false });
  });
  it('is the phantom estimate elsewhere, below the 1RM', () => {
    const t = prThresholdAt(sn, 3)!;
    expect(t.estimated).toBe(true);
    expect(t.kg).toBeLessThan(100);
    expect(t.kg).toBeGreaterThan(85);
  });
  it('is nothing when the lift has no entries at all', () => {
    const empty: PRLimit = { real: new Map(), anchors: [], oneRM: 100, name: 'Snatch' };
    expect(prThresholdAt(empty, 1)).toBeNull();
  });
});

describe('checkLineBeyondPR: one lift', () => {
  const limits = { self: buildPRLimits([hist('sn', 1, 100), hist('sn', 3, 90)], [cache('sn', 100)], nameOf).get('sn')! };

  it('marks a load above the real PR at that rep count', () => {
    const v = checkLineBeyondPR({ load: 92.5, reps: 3 }, 'absolute_kg', false, limits)!;
    expect(v).toMatchObject({ loadKg: 92.5, reps: 3, thresholdKg: 90, estimated: false, name: 'Snatch' });
  });
  it('does not mark a load equal to the PR, since matching is not a new one', () => {
    expect(checkLineBeyondPR({ load: 90, reps: 3 }, 'absolute_kg', false, limits)).toBeNull();
  });
  it('checks a single against the 1RM, not the 3RM', () => {
    expect(checkLineBeyondPR({ load: 95, reps: 1 }, 'absolute_kg', false, limits)).toBeNull();
    expect(checkLineBeyondPR({ load: 101, reps: 1 }, 'absolute_kg', false, limits)).not.toBeNull();
  });
  it('checks a load range at its top', () => {
    expect(checkLineBeyondPR({ load: 85, loadMax: 95, reps: 3 }, 'absolute_kg', false, limits)!.loadKg).toBe(95);
  });
  it('resolves a percentage through the cached 1RM before comparing', () => {
    // 95 % of 100 = 95 kg for a triple: above the 90 kg 3RM.
    const v = checkLineBeyondPR({ load: 95, reps: 3 }, 'percentage', false, limits)!;
    expect(v.loadKg).toBe(95);
    // 85 % = 85 kg for a triple: inside.
    expect(checkLineBeyondPR({ load: 85, reps: 3 }, 'percentage', false, limits)).toBeNull();
  });
  it('uses the estimate at a rep count that has no real entry', () => {
    const v = checkLineBeyondPR({ load: 99, reps: 2 }, 'absolute_kg', false, limits)!;
    expect(v.estimated).toBe(true);
    expect(v.reps).toBe(2);
  });
  it('never marks free text, an empty limit, or a lift with no PR', () => {
    expect(checkLineBeyondPR({ load: 200, reps: 1 }, 'free_text_reps', false, limits)).toBeNull();
    expect(checkLineBeyondPR({ load: 200, reps: 1 }, 'absolute_kg', false, null)).toBeNull();
    expect(checkLineBeyondPR({ load: 200, reps: 1 }, 'absolute_kg', false, { self: null })).toBeNull();
  });
});

describe('checkLineBeyondPR: a complex', () => {
  const all = buildPRLimits(
    [hist('cl', 1, 120), hist('cl', 2, 110), hist('jk', 1, 110), hist('jk', 2, 100)],
    [cache('cl', 120), cache('jk', 110)],
    nameOf,
  );
  const limits = { self: all.get('cl')!, members: [all.get('cl')!, all.get('jk')!] };

  it('checks each member at its own part of the tuple', () => {
    // Clean single at 105 is inside; jerk double at 105 is above the 100 kg 2RM.
    const v = checkLineBeyondPR({ load: 105, repsText: '1+2' }, 'absolute_kg', true, limits)!;
    expect(v).toMatchObject({ reps: 2, thresholdKg: 100, name: 'Jerk' });
  });
  it('is quiet when every member stays inside', () => {
    expect(checkLineBeyondPR({ load: 100, repsText: '1+1' }, 'absolute_kg', true, limits)).toBeNull();
  });
  it('scales a grouped tuple by its rounds', () => {
    // 2(1+1) at 105: two cleans and two jerks per set; the jerk double is above 100.
    const v = checkLineBeyondPR({ load: 105, repsText: '1+1', multiplier: 2 }, 'absolute_kg', true, limits)!;
    expect(v.name).toBe('Jerk');
    expect(v.reps).toBe(2);
  });
  it('skips a member whose PRs are unknown', () => {
    const partial = { self: all.get('cl')!, members: [all.get('cl')!, null] };
    expect(checkLineBeyondPR({ load: 105, repsText: '1+2' }, 'absolute_kg', true, partial)).toBeNull();
  });
});

describe('checkPrescriptionBeyondPR', () => {
  const limits = { self: buildPRLimits([hist('sn', 1, 100), hist('sn', 3, 90)], [cache('sn', 100)], nameOf).get('sn')! };
  it('is index-aligned to the parsed lines', () => {
    const out = checkPrescriptionBeyondPR('80x3, 92.5x3, 95x1x2', 'absolute_kg', false, limits);
    expect(out.map(v => v?.reps ?? null)).toEqual([null, 3, null]);
  });
  it('is empty for free text and for no limits', () => {
    expect(checkPrescriptionBeyondPR('heavy x 3', 'free_text_reps', false, limits)).toEqual([]);
    expect(checkPrescriptionBeyondPR('100x3', 'absolute_kg', false, null)).toEqual([]);
  });
});

describe('describePRVerdict', () => {
  it('reads with comma decimals and names the lift', () => {
    expect(describePRVerdict({ loadKg: 92.5, reps: 3, thresholdKg: 90, estimated: false, name: 'Snatch' }))
      .toBe('Would be a new 3RM — Snatch: 92,5 kg above 3RM 90 kg');
    expect(describePRVerdict({ loadKg: 99, reps: 2, thresholdKg: 96.5, estimated: true, name: 'Snatch' }))
      .toBe('Would be a new 2RM — Snatch: 99 kg above est. 2RM ~96,5 kg');
  });
});
