/**
 * Which phase covers a given macro week — the single source of truth.
 *
 * A phase claims a **week-number range** (`start_week_number`…`end_week_number`)
 * on its macrocycle. That is what the coach's phase panel writes and what the
 * coverage strip drags; there is no per-week assignment step in the product.
 *
 * `macro_weeks.phase_id` existed as a parallel FK but **nothing ever wrote it**
 * (0 of 158 rows populated in production), so every consumer that resolved a
 * phase through it silently got null — which is what emptied the phase
 * dimension in Analysis. The column is being retired; resolve through here.
 *
 * Kept free of React and Supabase so the coach app, the analysis layer and the
 * athlete app can all share one rule.
 */

/** The shape a phase must expose to be matched against a week. */
export interface PhaseRange {
  macrocycle_id: string;
  start_week_number: number;
  end_week_number: number;
}

/**
 * The phase covering `weekNumber` in `macroId`, or null for a free week.
 *
 * Ranges are inclusive at both ends. When phases overlap (the editor allows it)
 * the first match in the given order wins — callers pass phases ordered by
 * `position`, so the coach's own ordering decides.
 */
export function findPhaseForWeek<T extends PhaseRange>(
  phases: readonly T[],
  macroId: string,
  weekNumber: number | null | undefined,
): T | null {
  if (weekNumber == null) return null;
  return phases.find(
    p => p.macrocycle_id === macroId
      && weekNumber >= p.start_week_number
      && weekNumber <= p.end_week_number,
  ) ?? null;
}

/**
 * Same rule for a list already narrowed to one macrocycle — saves callers
 * threading the macro id through when they've grouped phases by cycle.
 */
export function findPhaseInCycle<T extends Omit<PhaseRange, 'macrocycle_id'>>(
  phases: readonly T[],
  weekNumber: number | null | undefined,
): T | null {
  if (weekNumber == null) return null;
  return phases.find(
    p => weekNumber >= p.start_week_number && weekNumber <= p.end_week_number,
  ) ?? null;
}
