/**
 * macroTargetUnit — what a macro exercise column's numbers MEAN.
 *
 * A macro target used to be a bare number with "kg" implicit in fourteen
 * readers. A column now declares its unit (`macro_tracked_exercises.
 * target_unit`), and this module is the single place that answers the questions
 * every one of those readers has to ask:
 *
 *   - what unit is this column in?          → `unitOf`
 *   - how does a cell read?                 → `formatTargetLoad`
 *   - does it belong in an aggregate?       → `isNumericUnit`
 *   - may it be summed with other columns?  → `contributesToTonnage`
 *
 * THE UNIT IS PER COLUMN, NOT PER CELL. That mirrors the weekly planner, where
 * `planned_exercises.unit` gives one exercise one unit, and it is what keeps
 * the aggregates honest — a column's Ø and peak are computed within one unit,
 * never across a mixture.
 *
 * A PERCENTAGE STAYS A PERCENTAGE. Nothing here converts one to kilograms:
 * there is no anchor, no PR lookup, no silent reinterpretation. A coach who
 * wants kilograms runs the deliberate convert flow, which suggests the athlete's
 * PR and lets them override it — the same flow the planner already uses for
 * percentage prescriptions.
 *
 * Pure — no Supabase, no React.
 */
import type { MacroTarget } from './database.types';

/** Matches `exercises.default_unit` / `planned_exercises.unit` vocabulary. */
export type MacroTargetUnit = 'absolute_kg' | 'percentage' | 'free_text_reps';

/** NULL in the database means kilograms — every row predating the column. */
export function unitOf(
  tracked: { target_unit?: string | null } | null | undefined,
): MacroTargetUnit {
  const u = tracked?.target_unit;
  return u === 'percentage' || u === 'free_text_reps' ? u : 'absolute_kg';
}

/** Does this column hold numbers at all? Free text does not. */
export const isNumericUnit = (u: MacroTargetUnit): boolean => u !== 'free_text_reps';

/**
 * May this column be added into a cross-exercise total (tonnage)?
 *
 * Only kilograms. Percentages are each relative to their own exercise, so
 * summing them across exercises produces a number that means nothing; free text
 * has no number at all. Callers that skip a column must SAY so rather than
 * quietly reporting a smaller total.
 */
export const contributesToTonnage = (u: MacroTargetUnit): boolean => u === 'absolute_kg';

/**
 * The macro unit implied by an exercise's library default.
 *
 * `exercises.default_unit` has six values; a macro column has three. RPE and
 * "other" have no macro equivalent, and a macro cell is a planned LOAD, so they
 * fall back to kilograms rather than inventing a fourth unit here — a coach who
 * wants prose types words and the column follows.
 */
export function unitFromDefaultUnit(
  defaultUnit: string | null | undefined,
): MacroTargetUnit {
  switch (defaultUnit) {
    case 'percentage': return 'percentage';
    case 'free_text':
    case 'free_text_reps': return 'free_text_reps';
    default: return 'absolute_kg';
  }
}

/** Suffix for a rendered number: "120" / "88 %" / — . */
export const unitSuffix = (u: MacroTargetUnit): string => (u === 'percentage' ? '%' : '');

/** Short label for the column header chip. */
export const unitLabel = (u: MacroTargetUnit): string =>
  u === 'percentage' ? '%' : u === 'free_text_reps' ? 'text' : 'kg';

/**
 * What a cell shows.
 *
 * A free-text column reads its prose from `target_text`; a numeric column reads
 * its number, with a `%` suffix when the column is percentages. Returns null
 * when the cell is empty, so callers render their own placeholder.
 */
export function formatTargetLoad(
  target: Pick<MacroTarget, 'target_max' | 'target_text'> | null | undefined,
  unit: MacroTargetUnit,
): string | null {
  if (!target) return null;
  if (unit === 'free_text_reps') {
    const text = target.target_text?.trim();
    return text ? text : null;
  }
  if (target.target_max == null) return null;
  const n = Number(target.target_max);
  if (!Number.isFinite(n)) return null;
  return `${fmtNumber(n)}${unitSuffix(unit)}`;
}

/** Comma decimals, German locale convention (CLAUDE.md). */
export function fmtNumber(v: number): string {
  return (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10)).replace('.', ',');
}

/**
 * The numeric values of a column, for its own Ø / peak row.
 *
 * Within one column the unit is constant, so averaging and peaking are
 * meaningful whether it is kilograms or percentages. A free-text column yields
 * nothing and its aggregate cells stay blank.
 */
export function numericValues(
  targets: Array<Pick<MacroTarget, 'target_max' | 'target_avg'>>,
  unit: MacroTargetUnit,
  field: 'target_max' | 'target_avg',
): number[] {
  if (!isNumericUnit(unit)) return [];
  const out: number[] = [];
  for (const t of targets) {
    const raw = t[field];
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length;

export const peak = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.max(...xs);

/**
 * Which unit a typed cell implies, using the SAME rule as the prescription
 * grid (`detectIntendedUnit`): a `%` means percentages, any letter means free
 * text, a plain number means kilograms. Returns null when the input implies
 * nothing, so the column keeps whatever it had.
 *
 * Typing re-units the whole COLUMN, which is fast to write but means a stray
 * letter can flip one. The column header shows its unit precisely so that flip
 * is visible immediately and is one click to undo.
 */
export function inferUnitFromInput(input: string): MacroTargetUnit | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Strip the separators the grid also ignores before looking for letters.
  const stripped = trimmed.replace(/[xX×*]/g, '');
  if (/[a-zA-ZæøåÆØÅ]/.test(stripped)) return 'free_text_reps';
  if (trimmed.includes('%')) return 'percentage';
  if (/\d/.test(stripped)) return 'absolute_kg';
  return null;
}

/** The numeric part of a typed cell, accepting comma decimals. Null if none. */
export function parseTargetNumber(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}
