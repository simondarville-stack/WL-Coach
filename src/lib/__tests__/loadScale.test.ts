import { describe, it, expect } from 'vitest';
import {
  scalePrescription,
  roundToStep,
  matchExerciseTerms,
  DEFAULT_ROUNDING,
  type SelectableExercise,
} from '../loadScaleService';
import { buildParentIndex } from '../exerciseHierarchy';
import { buildSetLineRows } from '../prescriptionWriteService';

describe('roundToStep', () => {
  it('rounds to the step and strips floating-point dust', () => {
    expect(roundToStep(0.8 * 72.5, 2.5)).toBe(57.5);
    expect(roundToStep(0.8 * 85, 2.5)).toBe(67.5);
    expect(roundToStep(64, 2.5)).toBe(65);
    expect(roundToStep(0.8 * 72.5, 1)).toBe(58);
  });
  it('step 0 keeps two decimals', () => {
    expect(roundToStep(0.8 * 77.7, 0)).toBe(62.16);
  });
});

describe('scalePrescription', () => {
  it('scales kg loads across segments, keeping reps and sets', () => {
    expect(scalePrescription('100×3×5', 'absolute_kg', false, 0.8).after).toBe('80×3×5');
    expect(scalePrescription('85×2, 90×1×2', 'absolute_kg', false, 0.8).after).toBe('67.5×2, 72.5×1×2');
  });

  it('scales percentages relatively — 80 % × 0,8 is 64 %, not 60 %', () => {
    expect(scalePrescription('80%×3×5', 'percentage', false, 0.8).after).toBe('64%×3×5');
    expect(scalePrescription('72.5%×2×3', 'percentage', false, 0.8).after).toBe('58%×2×3');
  });

  it('keeps ranges, set ranges and the soft-load comparator', () => {
    const r = scalePrescription('≥80-90×3×2-3', 'absolute_kg', false, 0.8);
    expect(r.after).toBe('≥65-72.5×3×2-3');
  });

  it('scales combo tuples and keeps the round multiplier', () => {
    expect(scalePrescription('80×1+2×3', 'absolute_kg', true, 0.8).after).toBe('65×1+2×3');
    expect(scalePrescription('80×2(1+2)×3', 'absolute_kg', true, 0.8).after).toBe('65×2(1+2)×3');
  });

  it('leaves non-numeric units alone and says why', () => {
    expect(scalePrescription('8×3×5', 'rpe', false, 0.8)).toMatchObject({ after: null, skipped: 'non-numeric-unit' });
    expect(scalePrescription('Heavy × 3 × 5', 'free_text', false, 0.8)).toMatchObject({ after: null, skipped: 'non-numeric-unit' });
    expect(scalePrescription('', 'absolute_kg', false, 0.8)).toMatchObject({ after: null, skipped: 'empty' });
    expect(scalePrescription(null, 'absolute_kg', false, 0.8)).toMatchObject({ after: null, skipped: 'empty' });
  });

  it('reports no-change when scaling rounds back to the same string', () => {
    expect(scalePrescription('100×3×5', 'absolute_kg', false, 1)).toMatchObject({ after: null, skipped: 'no-change' });
    expect(scalePrescription('2.5×3', 'absolute_kg', false, 0.99)).toMatchObject({ after: null, skipped: 'no-change' });
  });

  it('honours a custom rounding rule', () => {
    expect(scalePrescription('85×2', 'absolute_kg', false, 0.8, { ...DEFAULT_ROUNDING, absolute_kg: 0 }).after).toBe('68×2');
    expect(scalePrescription('85×2', 'absolute_kg', false, 0.8, { ...DEFAULT_ROUNDING, absolute_kg: 5 }).after).toBe('70×2');
  });

  it('refuses a non-positive factor', () => {
    expect(() => scalePrescription('100×3', 'absolute_kg', false, 0)).toThrow();
    expect(() => scalePrescription('100×3', 'absolute_kg', false, -0.2)).toThrow();
  });

  it('produces a string the cache rebuild parses back to the same lines', () => {
    const after = scalePrescription('≥80-90×3×2-3, 100×1', 'absolute_kg', false, 0.8).after!;
    const rows = buildSetLineRows('x', after, 'absolute_kg', false);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ load_value: 65, load_max: 72.5, load_cmp: '>=', sets: 2, sets_max: 3, reps: 3 });
    expect(rows[1]).toMatchObject({ load_value: 80, load_max: null, sets: 1, reps: 1, position: 2 });
  });
});

describe('matchExerciseTerms', () => {
  const ex = (o: Partial<SelectableExercise> & { id: string; name: string }): SelectableExercise => ({
    exercise_code: null, aliases: null, category: null, parent_exercise_id: null, ...o,
  });
  const catalogue = [
    ex({ id: 'sq', name: 'Squat', category: 'Squat' }),
    ex({ id: 'bs', name: 'Back Squat', category: 'Squat', parent_exercise_id: 'sq', exercise_code: 'BS' }),
    ex({ id: 'bsp', name: 'Back Squat pause', category: 'Squat', parent_exercise_id: 'bs' }),
    ex({ id: 'fs', name: 'Front Squat', category: 'Squat', parent_exercise_id: 'sq' }),
    ex({ id: 'dl', name: 'Deadlift', category: 'Pull', aliases: ['DL', 'Kreuzheben'] }),
    ex({ id: 'sn', name: 'Snatch', category: 'Snatch' }),
  ];
  const byId = new Map(catalogue.map(e => [e.id, e]));
  const parents = buildParentIndex(catalogue);

  it('matches by name, code and alias, case-insensitively', () => {
    expect(matchExerciseTerms('dl', byId, parents, { names: ['deadlift'] })).toEqual({ matched: true, via: 'name "Deadlift"' });
    expect(matchExerciseTerms('dl', byId, parents, { names: ['kreuzheben'] })).toEqual({ matched: true, via: 'name "Deadlift"' });
    expect(matchExerciseTerms('bs', byId, parents, { names: ['bs'] })).toEqual({ matched: true, via: 'name "Back Squat"' });
  });

  it('matches a child through any ancestor name', () => {
    expect(matchExerciseTerms('bs', byId, parents, { names: ['Squat'] })).toEqual({ matched: true, via: 'ancestor "Squat"' });
    expect(matchExerciseTerms('bsp', byId, parents, { names: ['Squat'] })).toEqual({ matched: true, via: 'ancestor "Squat"' });
    expect(matchExerciseTerms('bsp', byId, parents, { names: ['back squat'] })).toEqual({ matched: true, via: 'ancestor "Back Squat"' });
  });

  it('matches category on the exercise itself', () => {
    expect(matchExerciseTerms('dl', byId, parents, { categories: ['pull'] })).toEqual({ matched: true, via: 'category "Pull"' });
    expect(matchExerciseTerms('fs', byId, parents, { categories: ['Squat'] })).toEqual({ matched: true, via: 'category "Squat"' });
  });

  it('matches by id and rejects the rest', () => {
    expect(matchExerciseTerms('sn', byId, parents, { ids: ['sn'] }).matched).toBe(true);
    expect(matchExerciseTerms('sn', byId, parents, { names: ['squat', 'deadlift'], categories: ['pull'] }).matched).toBe(false);
    expect(matchExerciseTerms('missing', byId, parents, { names: ['squat'] }).matched).toBe(false);
  });
});
