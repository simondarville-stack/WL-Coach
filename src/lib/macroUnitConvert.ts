/**
 * macroUnitConvert — turn a macro exercise column from kilograms into
 * percentages, or back.
 *
 * This is the deliberate counterpart to `macroTargetUnit`, which never
 * converts anything. A percentage sitting in a macro column means nothing on
 * its own — it needs an anchor, and the only honest anchor is one a coach saw
 * and approved. So conversion is an explicit action with a reference per
 * column: the athlete's PR is *suggested*, and the coach can overwrite it.
 * That is exactly the weekly planner's ResolvePercentagesModal contract, and
 * this module produces the rows for the same modal's confirm step.
 *
 * WHAT CONVERTS: `target_max` and `target_avg` — the two loads. Reps, sets,
 * Σreps and notes are level-independent and are never touched. A free-text
 * column has no number and is never a conversion candidate.
 *
 * Pure — no Supabase, no React.
 */
import type { MacroTarget } from './database.types';
import { roundToStep } from './macroFillGuide';
import type { MacroTargetUnit } from './macroTargetUnit';

export type ConvertDirection = 'percent-to-kg' | 'kg-to-percent';

export interface ConvertRow {
  macro_week_id: string;
  tracked_exercise_id: string;
  fields: Partial<MacroTarget>;
}

/** The unit a column ends up in after converting. */
export const unitAfter = (direction: ConvertDirection): MacroTargetUnit =>
  direction === 'percent-to-kg' ? 'absolute_kg' : 'percentage';

/** The unit a column must currently be in to be a candidate. */
export const unitBefore = (direction: ConvertDirection): MacroTargetUnit =>
  direction === 'percent-to-kg' ? 'percentage' : 'absolute_kg';

/**
 * Convert one value against a reference.
 *
 * percent-to-kg: 85 (%) of a 120 kg reference → 102 kg, rounded to `step`.
 * kg-to-percent: 102 kg against 120 kg → 85 %, always to one decimal (a
 * percentage rounded to 2,5 would throw away the shape the coach drew).
 */
export function convertValue(
  value: number | null | undefined,
  direction: ConvertDirection,
  reference: number,
  roundingKg: number | null,
): number | null {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  if (!(reference > 0)) return null;
  if (direction === 'percent-to-kg') {
    const kg = (v * reference) / 100;
    return Math.max(0, roundingKg && roundingKg > 0 ? roundToStep(kg, roundingKg) : kg);
  }
  return Math.max(0, Math.round((v / reference) * 1000) / 10);
}

/**
 * The rows that convert one column, given the reference the coach settled on.
 *
 * Only cells that actually hold a load are emitted — converting an empty cell
 * would mint a row full of nulls across every week of a sparse cycle.
 */
export function buildConversionRows(
  trackedExerciseId: string,
  targets: MacroTarget[],
  direction: ConvertDirection,
  reference: number,
  roundingKg: number | null,
): ConvertRow[] {
  // Without a usable reference every value converts to null, and writing those
  // would ERASE the column instead of converting it. Emit nothing — the caller
  // reports the column as skipped.
  if (!(reference > 0)) return [];
  const rows: ConvertRow[] = [];
  for (const t of targets) {
    if (t.tracked_exercise_id !== trackedExerciseId) continue;
    if (t.target_max == null && t.target_avg == null) continue;
    const fields: Partial<MacroTarget> = {};
    if (t.target_max != null) fields.target_max = convertValue(t.target_max, direction, reference, roundingKg);
    if (t.target_avg != null) fields.target_avg = convertValue(t.target_avg, direction, reference, roundingKg);
    if (Object.keys(fields).length === 0) continue;
    rows.push({
      macro_week_id: t.macro_week_id,
      tracked_exercise_id: trackedExerciseId,
      fields,
    });
  }
  return rows;
}

/**
 * A one-line summary of what a column currently holds, for the modal's
 * "prescription" column: the load range and how many weeks carry one.
 */
export function describeColumn(
  trackedExerciseId: string,
  targets: MacroTarget[],
  unit: MacroTargetUnit,
): string {
  const vals = targets
    .filter(t => t.tracked_exercise_id === trackedExerciseId && t.target_max != null)
    .map(t => Number(t.target_max))
    .filter(v => Number.isFinite(v));
  if (vals.length === 0) return 'no loads';
  const suffix = unit === 'percentage' ? '%' : ' kg';
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const fmt = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',');
  const range = lo === hi ? `${fmt(lo)}${suffix}` : `${fmt(lo)}–${fmt(hi)}${suffix}`;
  return `${range} · ${vals.length} wk`;
}
