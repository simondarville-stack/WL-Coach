import { describe, it, expect } from 'vitest';
import {
  resolveUnitAlias, chooseUnit, pickExercise, comboAutoNotation, checkComboPrescription,
  type PickableExercise,
} from '../plannedRowService';

describe('comboAutoNotation', () => {
  it('joins the member names with " + ", as the planner does', () => {
    expect(comboAutoNotation(['Clean', 'Front Squat'])).toBe('Clean + Front Squat');
  });
});

describe('checkComboPrescription', () => {
  it('reads a combo tuple and reports how many lifts it names per set', () => {
    expect(checkComboPrescription('80×1+2×3')).toEqual({ ok: true, arity: 2 });
    expect(checkComboPrescription('Moderat×2(1+1+1)×3, Moderat×1(1+1+1)×4')).toEqual({ ok: true, arity: 3 });
    expect(checkComboPrescription('–×2+2×6')).toEqual({ ok: true, arity: 2 });
  });
  it('refuses what the combo parser cannot read', () => {
    expect(checkComboPrescription('Heavy').ok).toBe(false);
    expect(checkComboPrescription('×2+2×6').ok).toBe(false);
  });
});

describe('resolveUnitAlias', () => {
  it('maps the coach shorthand to stored units', () => {
    expect(resolveUnitAlias('kg')).toBe('absolute_kg');
    expect(resolveUnitAlias('%')).toBe('percentage');
    expect(resolveUnitAlias('RPE')).toBe('rpe');
    expect(resolveUnitAlias('free-reps')).toBe('free_text_reps');
    expect(resolveUnitAlias('absolute_kg')).toBe('absolute_kg');
    expect(resolveUnitAlias('lbs')).toBeNull();
    expect(resolveUnitAlias(undefined)).toBeNull();
  });
});

describe('chooseUnit', () => {
  it('explicit wins, then a % sign, then the exercise default', () => {
    expect(chooseUnit('rpe', '80%×5', 'absolute_kg')).toBe('rpe');
    expect(chooseUnit(null, '80%×5', 'absolute_kg')).toBe('percentage');
    expect(chooseUnit(null, '80×5', 'percentage')).toBe('percentage');
    expect(chooseUnit(null, null, 'absolute_kg')).toBe('absolute_kg');
  });
  it('letters in a numeric-default exercise flip to free_text_reps', () => {
    expect(chooseUnit(null, 'Heavy×3', 'absolute_kg')).toBe('free_text_reps');
    expect(chooseUnit(null, 'Heavy×3', 'free_text')).toBe('free_text');
  });
});

describe('pickExercise', () => {
  const ex = (o: Partial<PickableExercise> & { id: string; name: string }): PickableExercise => ({
    exercise_code: null, aliases: null, owner_id: 'coach-a', is_archived: false, ...o,
  });
  const cat = [
    ex({ id: 'bs', name: 'Back Squat', exercise_code: 'BS', aliases: ['Kniebeuge'] }),
    ex({ id: 'bs-club', name: 'Back Squat', owner_id: 'club' }),
    ex({ id: 'fs', name: 'Front Squat' }),
    ex({ id: 'old', name: 'Box Squat', is_archived: true }),
    ex({ id: 'dl', name: 'Deadlift' }),
  ];

  it('prefers the athlete owner on an exact-name tie', () => {
    expect(pickExercise('back squat', cat, { preferOwnerId: 'coach-a' })).toEqual({ kind: 'one', exercise: cat[0] });
    expect(pickExercise('back squat', cat, { preferOwnerId: 'club' })).toEqual({ kind: 'one', exercise: cat[1] });
  });
  it('prefers what the coach has planned before, over the owner', () => {
    expect(pickExercise('back squat', cat, { preferOwnerId: 'coach-a', preferIds: new Set(['bs-club']) }))
      .toEqual({ kind: 'one', exercise: cat[1] });
  });
  it('is ambiguous without an owner preference', () => {
    const r = pickExercise('Back Squat', cat);
    expect(r.kind).toBe('many');
  });
  it('matches by id, code and alias', () => {
    const o = { preferOwnerId: 'coach-a' };
    expect(pickExercise('fs', cat, o)).toMatchObject({ kind: 'one', exercise: { id: 'fs' } });
    expect(pickExercise('BS', cat, o)).toMatchObject({ kind: 'one', exercise: { id: 'bs' } });
    expect(pickExercise('kniebeuge', cat, o)).toMatchObject({ kind: 'one', exercise: { id: 'bs' } });
  });
  it('falls back to a unique substring, and to archived rows only when nothing live matches', () => {
    const o = { preferOwnerId: 'coach-a' };
    expect(pickExercise('dead', cat, o)).toMatchObject({ kind: 'one', exercise: { id: 'dl' } });
    expect(pickExercise('squat', cat, o).kind).toBe('many');
    expect(pickExercise('box', cat, o)).toMatchObject({ kind: 'one', exercise: { id: 'old' } });
    expect(pickExercise('bench', cat, o)).toEqual({ kind: 'none' });
  });
});
