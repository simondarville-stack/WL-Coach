import { describe, it, expect } from 'vitest';
import { buildTemplatePayload, materializeTemplate } from '../macroTemplate';
import type {
  MacroPhase,
  MacroTarget,
  MacroTrackedExerciseWithExercise,
  MacroWeek,
} from '../database.types';

function mkWeek(n: number, type = 'm', totalReps: number | null = null): MacroWeek {
  return {
    id: `week-${n}`, macrocycle_id: 'mc', week_start: '2026-07-06', week_number: n,
    week_type: type, week_type_text: '', notes: '', total_reps_target: totalReps,
    tonnage_target: null, avg_intensity_target: null, phase_id: null,
    volume_multiplier: 1, created_at: '', updated_at: '',
  };
}

function mkTe(id: string, name: string, referenceKg: number | null, position = 0): MacroTrackedExerciseWithExercise {
  return {
    id, macrocycle_id: 'mc', exercise_id: `ex-${id}`, position, reference_kg: referenceKg,
    created_at: '', updated_at: '',
    exercise: { id: `ex-${id}`, name, exercise_code: null } as MacroTrackedExerciseWithExercise['exercise'],
  };
}

function mkTarget(weekN: number, teId: string, fields: Partial<MacroTarget>): MacroTarget {
  return {
    id: `t-${weekN}-${teId}`, macro_week_id: `week-${weekN}`, tracked_exercise_id: teId,
    target_reps: null, target_avg: null, target_max: null,
    target_reps_at_max: null, target_sets_at_max: null, note: null,
    created_at: '', updated_at: '', ...fields,
  };
}

const PHASES: MacroPhase[] = [{
  id: 'p1', owner_id: 'o', macrocycle_id: 'mc', name: 'Prep', phase_type: 'preparatory',
  start_week_number: 1, end_week_number: 3, color: '#DBEAFE', notes: '', position: 1,
  created_at: '', updated_at: '',
}];

describe('macro templates — kg mode round trip', () => {
  it('stores and re-materializes loads unchanged', () => {
    const weeks = [mkWeek(1, 'h', 300), mkWeek(2, 'g'), mkWeek(3, 'm')];
    const te = mkTe('te1', 'Snatch', 150);
    const targets = [
      mkTarget(1, 'te1', { target_max: 120, target_avg: 96, target_reps: 20, note: '3RM' }),
      mkTarget(3, 'te1', { target_max: 140 }),
    ];
    const payload = buildTemplatePayload('kg', weeks, PHASES, [te], targets);
    const mat = materializeTemplate({ mode: 'kg', payload });

    expect(mat.weeks).toHaveLength(3);
    expect(mat.weeks[0]).toMatchObject({ week_number: 1, week_type: 'h', total_reps_target: 300 });
    expect(mat.phases[0]).toMatchObject({ name: 'Prep', end_week_number: 3 });
    const w1 = mat.targets.find(t => t.week_number === 1)!;
    expect(w1.fields).toMatchObject({ target_max: 120, target_avg: 96, target_reps: 20, note: '3RM' });
    expect(mat.targets.find(t => t.week_number === 3)!.fields.target_max).toBe(140);
  });
});

describe('macro templates — general model (%)', () => {
  const weeks = [mkWeek(1), mkWeek(2)];
  const te = mkTe('te1', 'Snatch', 150);
  const targets = [
    mkTarget(1, 'te1', { target_max: 120, target_avg: 96, target_reps: 20 }),
    mkTarget(2, 'te1', { target_max: 150 }),
  ];

  it('stores loads as % of the reference; reps stay absolute', () => {
    const payload = buildTemplatePayload('pct', weeks, [], [te], targets);
    const ex = payload.exercises[0];
    expect(ex.reference_kg).toBe(150);
    expect(ex.targets.find(t => t.week_number === 1)!.max).toBe(80);    // 120/150
    expect(ex.targets.find(t => t.week_number === 1)!.avg).toBe(64);    // 96/150
    expect(ex.targets.find(t => t.week_number === 1)!.reps).toBe(20);   // absolute
    expect(ex.targets.find(t => t.week_number === 2)!.max).toBe(100);
  });

  it('re-anchors to a stronger athlete via the apply-time reference', () => {
    const payload = buildTemplatePayload('pct', weeks, [], [te], targets);
    const mat = materializeTemplate({ mode: 'pct', payload }, { 'ex-te1': 170 });
    expect(mat.targets.find(t => t.week_number === 1)!.fields.target_max).toBe(135); // 80% of 170 → 136 → 2,5 rounding = 135
    expect(mat.targets.find(t => t.week_number === 2)!.fields.target_max).toBe(170); // 100 %
    expect(mat.targets.find(t => t.week_number === 1)!.fields.target_reps).toBe(20);
    expect(mat.exercises[0].reference_kg).toBe(170);
  });

  it('same-reference apply reproduces the source loads (2,5 kg rounding)', () => {
    const payload = buildTemplatePayload('pct', weeks, [], [te], targets);
    const mat = materializeTemplate({ mode: 'pct', payload }, {});
    expect(mat.targets.find(t => t.week_number === 1)!.fields.target_max).toBe(120);
    expect(mat.targets.find(t => t.week_number === 2)!.fields.target_max).toBe(150);
  });

  it('falls back to the peak max as auto-reference when none is saved', () => {
    const noRef = mkTe('te2', 'C&J', null);
    const t = [mkTarget(1, 'te2', { target_max: 90 }), mkTarget(2, 'te2', { target_max: 180 })];
    const payload = buildTemplatePayload('pct', weeks, [], [noRef], t);
    expect(payload.exercises[0].reference_kg).toBe(180);   // peak = 100 %
    expect(payload.exercises[0].targets.find(x => x.week_number === 1)!.max).toBe(50);
  });

  it('drops loads (never guesses kg) when applied without a usable reference, keeping reps/notes', () => {
    const payload = buildTemplatePayload('pct', weeks, [], [te], [
      mkTarget(1, 'te1', { target_max: 120, target_reps: 20, note: 'hold back' }),
    ]);
    const mat = materializeTemplate({ mode: 'pct', payload }, { 'ex-te1': null });
    const w1 = mat.targets.find(t => t.week_number === 1)!;
    expect(w1.fields.target_max).toBeUndefined();
    expect(w1.fields.target_reps).toBe(20);
    expect(w1.fields.note).toBe('hold back');
  });
});
