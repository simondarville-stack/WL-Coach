/**
 * macroColumnCopy — copy one macro exercise's whole prescription onto another.
 *
 * A "macro prescription" for an exercise column IS its set of `macro_targets`
 * rows, one per week: `target_max`, `target_avg`, `target_reps`,
 * `target_reps_at_max`, `target_sets_at_max` and the coach's `note`. Nothing
 * else in an exercise column lives outside that table — `reference_kg` is the
 * destination lift's own %-anchor and is deliberately NOT copied, and the
 * week-level Σreps / tonnage / avg-intensity targets belong to the week, not to
 * an exercise.
 *
 * **Mirror, not merge.** A week the source left empty CLEARS the destination.
 * "Copy the prescription" means the destination ends up looking like the
 * source; a merge that only wrote non-null values would leave stale numbers
 * behind on exactly the weeks the coach deliberately left blank.
 *
 * **Rescaling.** Copying Snatch's 120 kg column literally onto Back Squat is
 * usually nonsense; what a coach means is the same *shape* at the destination's
 * own level. So when BOTH tracked exercises carry a `reference_kg`, loads are
 * scaled by the ratio — the same rule `macroTemplate` already uses to
 * materialise a template. When either reference is missing there is nothing to
 * scale against, so the copy is raw. Reps, sets and notes are level-independent
 * and always copy absolute.
 *
 * Pure: no Supabase, no React.
 */
import { roundToStep, DEFAULT_LOAD_ROUNDING_KG } from './macroFillGuide';
import type { MacroTarget, MacroWeek } from './database.types';

/** Every field that belongs to an exercise column's prescription. */
export const COPYABLE_TARGET_FIELDS = [
  'target_max',
  'target_avg',
  'target_reps',
  'target_reps_at_max',
  'target_sets_at_max',
  'note',
] as const;

export interface ColumnCopyOptions {
  /** Present ⇒ scale loads from the source's level to the destination's. */
  rescale?: { fromRef: number; toRef: number; roundingKg?: number } | null;
  /** Copy the coach's per-week note too. Default true — it is part of the cell. */
  includeNote?: boolean;
}

export interface ColumnCopyRow {
  macro_week_id: string;
  tracked_exercise_id: string;
  fields: Partial<MacroTarget>;
}

const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : Number(v);

/**
 * The rows to upsert so `targetTeId` mirrors `sourceTeId` across `macroWeeks`.
 *
 * Every emitted row carries the FULL field set, which is what makes the copy a
 * faithful mirror and also lets `bulkUpsertTargets` collapse the whole thing
 * into a single request (it groups by field signature). A week is skipped only
 * when the source AND the destination are both already empty — no point minting
 * all-null rows across a sparse cycle.
 */
export function buildColumnCopyRows(
  sourceTeId: string,
  targetTeId: string,
  macroWeeks: MacroWeek[],
  targets: MacroTarget[],
  opts: ColumnCopyOptions = {},
): ColumnCopyRow[] {
  if (sourceTeId === targetTeId) return [];
  const includeNote = opts.includeNote ?? true;
  const rescale = opts.rescale ?? null;
  const step = rescale?.roundingKg ?? DEFAULT_LOAD_ROUNDING_KG;

  const scaleLoad = (v: number | null): number | null => {
    if (v == null) return null;
    if (!rescale || !(rescale.fromRef > 0) || !(rescale.toRef > 0)) return v;
    return Math.max(0, roundToStep((v / rescale.fromRef) * rescale.toRef, step));
  };

  const srcByWeek = new Map<string, MacroTarget>();
  const dstByWeek = new Map<string, MacroTarget>();
  for (const t of targets) {
    if (t.tracked_exercise_id === sourceTeId) srcByWeek.set(t.macro_week_id, t);
    else if (t.tracked_exercise_id === targetTeId) dstByWeek.set(t.macro_week_id, t);
  }

  const rows: ColumnCopyRow[] = [];
  for (const week of macroWeeks) {
    const src = srcByWeek.get(week.id);
    const dst = dstByWeek.get(week.id);
    if (!isFilled(src) && !isFilled(dst)) continue;
    rows.push({
      macro_week_id: week.id,
      tracked_exercise_id: targetTeId,
      fields: {
        target_max: scaleLoad(num(src?.target_max)),
        target_avg: scaleLoad(num(src?.target_avg)),
        target_reps: src?.target_reps ?? null,
        target_reps_at_max: src?.target_reps_at_max ?? null,
        target_sets_at_max: src?.target_sets_at_max ?? null,
        ...(includeNote ? { note: src?.note ?? null } : {}),
      },
    });
  }
  return rows;
}

/** Does this target row hold anything a coach typed? */
export function isFilled(t: MacroTarget | undefined | null): boolean {
  if (!t) return false;
  return t.target_max != null
    || t.target_avg != null
    || t.target_reps != null
    || t.target_reps_at_max != null
    || t.target_sets_at_max != null
    || !!t.note?.trim();
}

/** How many weeks of the destination column already hold coach values. */
export function countFilledWeeks(targetTeId: string, targets: MacroTarget[]): number {
  return targets.filter(t => t.tracked_exercise_id === targetTeId && isFilled(t)).length;
}
