import { describe, it, expect } from 'vitest';
import { buildFillPlan, FILL_TARGET_ALL, FILL_TARGET_SREPS, type FillGuideInputs } from '../fillGuidePlan';
import type {
  MacroTarget,
  MacroTrackedExerciseWithExercise,
  MacroWeek,
  RhythmPreset,
  WeekTypeConfig,
} from '../../../lib/database.types';

const WEEK_TYPES: WeekTypeConfig[] = [
  { name: 'High', abbreviation: 'h', color: '#E24B4A' },
  { name: 'Medium', abbreviation: 'm', color: '#EF9F27' },
  { name: 'Low', abbreviation: 'g', color: '#1D9E75' },
];

const FLAT: RhythmPreset = {
  id: 'flat', name: 'Flat', mode: 'pattern',
  pattern: [{ load: 100, reps: 100 }], stampTypes: null,
};

const STAMPING: RhythmPreset = {
  id: 's', name: 'Stamping', mode: 'pattern',
  pattern: [{ load: 100, reps: 100 }, { load: 90, reps: 110 }],
  stampTypes: ['h', 'g'],
};

function mkWeek(n: number, type = 'm', totalReps: number | null = null): MacroWeek {
  return {
    id: `week-${n}`,
    macrocycle_id: 'mc-1',
    week_start: '2026-07-06',
    week_number: n,
    week_type: type,
    week_type_text: '',
    notes: '',
    total_reps_target: totalReps,
    tonnage_target: null,
    avg_intensity_target: null,
    phase_id: null,
    volume_multiplier: 1,
    created_at: '',
    updated_at: '',
  };
}

function mkTe(id: string, name: string, referenceKg: number | null): MacroTrackedExerciseWithExercise {
  return {
    id,
    macrocycle_id: 'mc-1',
    exercise_id: `ex-${id}`,
    position: 0,
    reference_kg: referenceKg,
    created_at: '',
    updated_at: '',
    exercise: { id: `ex-${id}`, name, exercise_code: null } as MacroTrackedExerciseWithExercise['exercise'],
  };
}

function mkTarget(weekId: string, teId: string, max: number | null): MacroTarget {
  return {
    id: `t-${weekId}-${teId}`,
    macro_week_id: weekId,
    tracked_exercise_id: teId,
    target_reps: null,
    target_avg: null,
    target_max: max,
    target_reps_at_max: null,
    target_sets_at_max: null,
    note: null,
    created_at: '',
    updated_at: '',
  };
}

const baseInputs: FillGuideInputs = {
  target: 'te-1',
  unit: 'kg',
  fromWeek: 1,
  fromValue: 100,
  toWeek: 4,
  toValue: 130,
  fillReps: true,
  repsFrom: 20,
  repsTo: 10,
  mirror: true,
  mirrorPct: 20,
  overwrite: false,
  stamp: false,
  loadRoundingKg: 2.5,
  rhythm: FLAT,
};

const weeks = [mkWeek(1), mkWeek(2), mkWeek(3), mkWeek(4)];

describe('buildFillPlan — exercise fill', () => {
  it('emits target rows keyed by week id with max/avg/reps fields', () => {
    const te = mkTe('te-1', 'Snatch', null);
    const plan = buildFillPlan(baseInputs, weeks, [te], [], WEEK_TYPES);
    expect(plan.cellCount).toBe(4);
    expect(plan.targetRows).toHaveLength(4);
    const w1 = plan.targetRows.find(r => r.macro_week_id === 'week-1')!;
    expect(w1.tracked_exercise_id).toBe('te-1');
    expect(w1.fields.target_max).toBe(100);
    expect(w1.fields.target_avg).toBe(80);
    expect(w1.fields.target_reps).toBe(20);
    expect(plan.preview.byTrackedEx['te-1']['week-4'].max).toBe(130);
  });

  it('omits avg/reps fields when mirror/fillReps are off', () => {
    const te = mkTe('te-1', 'Snatch', null);
    const plan = buildFillPlan(
      { ...baseInputs, mirror: false, fillReps: false },
      weeks, [te], [], WEEK_TYPES,
    );
    const w1 = plan.targetRows[0];
    expect('target_avg' in w1.fields).toBe(false);
    expect('target_reps' in w1.fields).toBe(false);
  });

  it('skips weeks with an existing max unless overwrite', () => {
    const te = mkTe('te-1', 'Snatch', null);
    const existing = [mkTarget('week-2', 'te-1', 120)];
    const kept = buildFillPlan(baseInputs, weeks, [te], existing, WEEK_TYPES);
    expect(kept.targetRows.some(r => r.macro_week_id === 'week-2')).toBe(false);
    expect(kept.cellCount).toBe(3);

    const over = buildFillPlan({ ...baseInputs, overwrite: true }, weeks, [te], existing, WEEK_TYPES);
    expect(over.targetRows.some(r => r.macro_week_id === 'week-2')).toBe(true);
  });

  it('a note-only target row does not count as existing', () => {
    const te = mkTe('te-1', 'Snatch', null);
    const noteOnly = { ...mkTarget('week-2', 'te-1', null), note: '3RM this week' };
    const plan = buildFillPlan(baseInputs, weeks, [te], [noteOnly], WEEK_TYPES);
    expect(plan.targetRows.some(r => r.macro_week_id === 'week-2')).toBe(true);
  });
});

describe('buildFillPlan — % of reference and all-exercises', () => {
  it('single exercise in % mode resolves against its reference', () => {
    const te = mkTe('te-1', 'Snatch', 150);
    const plan = buildFillPlan(
      { ...baseInputs, unit: 'pct', fromValue: 80, toValue: 100 },
      weeks, [te], [], WEEK_TYPES,
    );
    expect(plan.targetRows.find(r => r.macro_week_id === 'week-1')!.fields.target_max).toBe(120);
    expect(plan.targetRows.find(r => r.macro_week_id === 'week-4')!.fields.target_max).toBe(150);
  });

  it('all-exercises fills each from its own reference and lists skipped ones', () => {
    const withRef = mkTe('te-1', 'Snatch', 100);
    const withRef2 = mkTe('te-2', 'Clean & Jerk', 200);
    const noRef = mkTe('te-3', 'Back Squat', null);
    const plan = buildFillPlan(
      { ...baseInputs, target: FILL_TARGET_ALL, unit: 'pct', fromValue: 80, toValue: 100 },
      weeks, [withRef, withRef2, noRef], [], WEEK_TYPES,
    );
    expect(plan.preview.byTrackedEx['te-1']['week-1'].max).toBe(80);
    expect(plan.preview.byTrackedEx['te-2']['week-1'].max).toBe(160);
    expect(plan.preview.byTrackedEx['te-3']).toBeUndefined();
    expect(plan.skippedNoReference).toEqual(['Back Squat']);
  });
});

describe('buildFillPlan — general Σreps and stamps', () => {
  it('Σreps fill produces week updates, skipping weeks that already have a target', () => {
    const wk = [mkWeek(1), mkWeek(2, 'm', 300), mkWeek(3), mkWeek(4)];
    const plan = buildFillPlan(
      { ...baseInputs, target: FILL_TARGET_SREPS, fromValue: 400, toValue: 100 },
      wk, [], [], WEEK_TYPES,
    );
    expect(plan.weekUpdates.some(u => u.id === 'week-2')).toBe(false);
    expect(plan.weekUpdates.find(u => u.id === 'week-1')?.total_reps_target).toBe(400);
    expect(plan.cellCount).toBe(3);
  });

  it('merges a stamp and a Σreps value into one update per week', () => {
    const plan = buildFillPlan(
      { ...baseInputs, target: FILL_TARGET_SREPS, fromValue: 400, toValue: 100, stamp: true, rhythm: STAMPING },
      weeks, [], [], WEEK_TYPES,
    );
    const w1 = plan.weekUpdates.find(u => u.id === 'week-1')!;
    expect(w1.total_reps_target).toBeDefined();
    expect(w1.week_type).toBe('h');
    // one entry per week, not two
    expect(plan.weekUpdates.filter(u => u.id === 'week-1')).toHaveLength(1);
  });

  it('does not emit a stamp when the week already has that type', () => {
    const wk = [mkWeek(1, 'h'), mkWeek(2, 'm')];
    const plan = buildFillPlan(
      { ...baseInputs, toWeek: 2, stamp: true, rhythm: STAMPING, target: 'te-1' },
      wk, [mkTe('te-1', 'Snatch', null)], [], WEEK_TYPES,
    );
    // week 1 already 'h' → no stamp; week 2 gets 'g'
    expect(plan.preview.weekTypeStamps['week-1']).toBeUndefined();
    expect(plan.preview.weekTypeStamps['week-2']).toBe('g');
  });
});
