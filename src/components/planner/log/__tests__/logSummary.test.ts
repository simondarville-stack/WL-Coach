import { describe, it, expect } from 'vitest';
import {
  computeExerciseSummary,
  isQuantifiedUnit,
  isAbsoluteLoadUnit,
} from '../logSummary';
import type { PlannedExercise, Exercise, GppSection } from '../../../../lib/database.types';
import type { LoggedExerciseFull } from '../../../../lib/trainingLogModel';

/** Minimal PlannedExercise + joined Exercise factory for the summary tests. */
function planned(
  over: Partial<PlannedExercise> & { exercise?: Partial<Exercise> } = {},
): PlannedExercise & { exercise: Exercise } {
  const { exercise: exOver, ...rest } = over;
  return {
    id: 'pe1',
    weekplan_id: 'wp1',
    day_index: 0,
    exercise_id: 'ex1',
    position: 0,
    notes: null,
    unit: 'absolute_kg',
    prescription_raw: '100x3x3',
    summary_total_sets: 3,
    summary_total_reps: 9,
    summary_highest_load: 100,
    summary_avg_load: 100,
    variation_note: null,
    is_combo: false,
    combo_notation: null,
    combo_color: null,
    source: 'individual',
    metadata: {},
    created_at: '',
    updated_at: '',
    ...rest,
    exercise: {
      id: 'ex1',
      name: 'Back Squat',
      exercise_code: null,
      category: 'Squat',
      color: null,
      counts_towards_totals: true,
      ...exOver,
    } as Exercise,
  };
}

function gppPlanned(rows: GppSection['rows']): PlannedExercise & { exercise: Exercise } {
  return planned({
    exercise: { exercise_code: 'GPP', name: 'GPP', category: 'General' },
    metadata: { gpp: { title: 'Core', description: '', rows } },
  });
}

function loggedGpp(rows: GppSection['rows']): LoggedExerciseFull {
  return {
    log: { id: 'le1', metadata: { gpp: { title: 'Core', description: '', rows } } } as never,
    sets: [],
    exercise: null,
  };
}

describe('isQuantifiedUnit', () => {
  it('treats absolute_kg / percentage / free_text_reps as quantified', () => {
    expect(isQuantifiedUnit('absolute_kg')).toBe(true);
    expect(isQuantifiedUnit('percentage')).toBe(true);
    expect(isQuantifiedUnit('free_text_reps')).toBe(true);
  });
  it('treats free_text / other / rpe as non-quantified', () => {
    expect(isQuantifiedUnit('free_text')).toBe(false);
    expect(isQuantifiedUnit('other')).toBe(false);
    expect(isQuantifiedUnit('rpe')).toBe(false);
  });
});

describe('isAbsoluteLoadUnit', () => {
  it('only absolute_kg is a real kilogram load', () => {
    expect(isAbsoluteLoadUnit('absolute_kg')).toBe(true);
    expect(isAbsoluteLoadUnit('percentage')).toBe(false);
    expect(isAbsoluteLoadUnit(null)).toBe(false);
  });
});

describe('computeExerciseSummary — GPP rollup (COACH-REVIEW-2)', () => {
  it('reads exercise_code off the joined exercise so GPP rows count', () => {
    const rows = [
      { exercise: 'Plank', reps: '30', sets: 2, load: 'BW', done: true },
      { exercise: 'Hollow', reps: '20', sets: 1, load: 'BW', done: false },
    ];
    const summary = computeExerciseSummary(gppPlanned(rows), loggedGpp(rows));
    // 2*1 + 1*1 planned sets = 3; completed = only the done row → 2
    expect(summary.sets.planned).toBe(3);
    expect(summary.sets.actual).toBe(2);
    expect(summary.reps.planned).toBe(2 * 30 + 1 * 20);
    expect(summary.reps.actual).toBe(2 * 30);
  });
});

describe('computeExerciseSummary — load axes by unit (COACH-REVIEW-4)', () => {
  it('keeps planned load for absolute_kg', () => {
    const summary = computeExerciseSummary(planned({ unit: 'absolute_kg' }), null);
    expect(summary.avgLoad.planned).toBe(100);
    expect(summary.maxLoad.planned).toBe(100);
  });
  it('suppresses planned load for percentage (percent is not kg)', () => {
    const summary = computeExerciseSummary(
      planned({ unit: 'percentage', summary_avg_load: 80, summary_highest_load: 85 }),
      null,
    );
    expect(summary.avgLoad.planned).toBeNull();
    expect(summary.maxLoad.planned).toBeNull();
    // Sets/Reps stay valid for percentage.
    expect(summary.sets.planned).toBe(3);
  });
});
