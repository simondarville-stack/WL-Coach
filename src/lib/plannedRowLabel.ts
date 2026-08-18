// What a planned row is CALLED on screen.
//
// Three things can name a row and they had eight separate fallback chains
// before this module, which is how a per-instance override would have reached
// some surfaces and not others. See docs/DISPLAY_CONVENTIONS.md.

/** The naming fields of a planned_exercises row. Structural so the many row
 *  shapes across the app (nested `exercise`, flat snapshots, template rows)
 *  can all pass what they have. */
export interface PlannedRowNaming {
  display_name?: string | null;
  is_combo?: boolean | null;
  combo_notation?: string | null;
}

interface LabelOptions {
  /** Member exercise names, in position order — used to auto-name a combo. */
  memberNames?: (string | null | undefined)[];
  /** The catalogue exercise's own name. */
  exerciseName?: string | null;
  /** Shown when nothing else resolves. */
  fallback?: string;
}

/**
 * Precedence:
 *   1. `display_name` — the coach's per-instance override. Wins for every row
 *      kind, combos included: it is the most specific thing anyone said.
 *   2. `combo_notation` — a combo's own name.
 *   3. the members joined with " + " — a combo's automatic name.
 *   4. the catalogue exercise's name.
 *
 * Overriding never touches `exercise_id`, so logs and analysis stay attached to
 * the original exercise; only the label changes, and only on this one row.
 */
export function plannedRowLabel(row: PlannedRowNaming, opts: LabelOptions = {}): string {
  const override = row.display_name?.trim();
  if (override) return override;

  if (row.is_combo) {
    const notation = row.combo_notation?.trim();
    if (notation) return notation;
    const joined = (opts.memberNames ?? []).filter(Boolean).join(' + ');
    if (joined) return joined;
  }

  return opts.exerciseName?.trim() || opts.fallback || 'Exercise';
}

/** True when this row shows a coach-typed name rather than its catalogue one,
 *  so a surface can mark it (the underlying exercise is not obvious). */
export function hasNameOverride(row: PlannedRowNaming): boolean {
  return !!row.display_name?.trim();
}
