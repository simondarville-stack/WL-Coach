// What one exercise reads as in the scheduled week's condensed card:
//
//     max            average weight
//     ───            ──────────────      · S <total sets>
//     reps at max    average reps
//
// The four headline numbers are the SAME stored `summary_*` fields the planner's
// per-exercise analysis column shows, so the two cannot disagree — and because
// those columns already have the coach's Σ/S/Ø feature overrides baked in at
// save time, the overrides are honoured here for free.
//
// Two of the six values are not stored and are derived:
//   · reps at max — the reps of the heaviest set line, parsed from the
//     prescription. The same quantity the macro calls `target_reps_at_max`.
//   · average reps — total reps ÷ total sets.

import { parsePrescription, parseComboPrescription } from './prescriptionParser';
import type { PlannedExercise, Exercise } from './database.types';

export interface CondensedExerciseSummary {
  /** Heaviest load. Null for a free-text or load-less row. */
  max: number | null;
  /** Reps of the heaviest set line. Null when the prescription has no parseable load. */
  repsAtMax: number | null;
  /** Weighted average load. */
  avgLoad: number | null;
  /** Total reps ÷ total sets, to one decimal. Null when there are no sets. */
  avgReps: number | null;
  sets: number | null;
  reps: number | null;
}

/**
 * Whether this exercise shows a planner summary at all. Mirrors the rule the
 * day card already uses, so switching the summary off in the exercise settings
 * silences it in the condensed card too.
 */
export function showsPlannerSummary(exercise: Pick<Exercise, 'show_planner_summary' | 'counts_towards_totals'>): boolean {
  return exercise.show_planner_summary ?? exercise.counts_towards_totals ?? true;
}

/** Reps of the heaviest set line in a prescription. */
export function repsAtMaxOf(raw: string | null, isCombo: boolean): number | null {
  if (!raw?.trim()) return null;
  try {
    // A combo's reps are a tuple ("1+2"); the parser already sums one round
    // into totalReps, which is the number to show against its heaviest load.
    if (isCombo) {
      const lines = parseComboPrescription(raw);
      if (lines.length === 0) return null;
      const top = lines.reduce((a, b) => ((b.loadMax ?? b.load) >= (a.loadMax ?? a.load) ? b : a));
      return top.totalReps ?? null;
    }
    const lines = parsePrescription(raw);
    if (lines.length === 0) return null;
    // The top of a range is the load actually reached, which is what "max" means
    // everywhere else in EMOS.
    const top = lines.reduce((a, b) => ((b.loadMax ?? b.load) >= (a.loadMax ?? a.load) ? b : a));
    return top.repsMax ?? top.reps ?? null;
  } catch {
    // Free text or an unparseable prescription — the stored summary still
    // carries the loads, only reps-at-max is unknowable.
    return null;
  }
}

type Row = Pick<
  PlannedExercise,
  'prescription_raw' | 'is_combo' | 'summary_highest_load' | 'summary_avg_load' | 'summary_total_reps' | 'summary_total_sets'
> & { exercise: Pick<Exercise, 'show_planner_summary' | 'counts_towards_totals'> };

/**
 * Null when the exercise's planner summary is switched off, or when it has
 * nothing to report — a row with no loads and no sets prints nothing rather
 * than a line of dashes.
 */
export function condensedExerciseSummary(ex: Row): CondensedExerciseSummary | null {
  if (!showsPlannerSummary(ex.exercise)) return null;

  const max = ex.summary_highest_load ?? null;
  const avgLoad = ex.summary_avg_load ?? null;
  const reps = ex.summary_total_reps ?? null;
  const sets = ex.summary_total_sets ?? null;

  if (!max && !avgLoad && !sets) return null;

  const avgReps = sets && sets > 0 && reps != null
    ? Math.round((reps / sets) * 10) / 10
    : null;

  return {
    max: max && max > 0 ? max : null,
    repsAtMax: repsAtMaxOf(ex.prescription_raw, ex.is_combo === true),
    avgLoad: avgLoad && avgLoad > 0 ? avgLoad : null,
    avgReps,
    sets: sets && sets > 0 ? sets : null,
    reps,
  };
}
