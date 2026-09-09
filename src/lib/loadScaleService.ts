// Scale the loads of selected exercises in a week by a factor — the "20 %
// lighter in squats and deadlifts" verb.
//
// Two layers:
//   • pure: `scalePrescription` (one raw string → the scaled raw string, or a
//     reason it was left alone) and `matchExerciseTerms` (does a planned row's
//     exercise, or any ancestor of it, match what the coach named);
//   • Supabase: `scaleWeekLoads` reads a week, builds a change set, and — only
//     when asked — writes it through `writePrescriptionRecord`, so the summary
//     and set-line caches are rebuilt exactly as a planner edit would.
//
// A change set is always produced first (dry run is the default) so the coach
// sees every before/after before anything is written. Group plans are refused:
// they are planned and synced through the planner, and a direct edit here
// would not reach the athletes.
//
// No React, no stores. Used by scripts/emos-cli.ts; usable from the app.

import type { DefaultUnit, WeekPlan } from './database.types';
import {
  parsePrescription,
  parseComboPrescription,
  formatPrescription,
  formatComboPrescription,
} from './prescriptionParser';
import {
  buildParentIndex,
  resolveAncestorPath,
  type ParentIndex,
} from './exerciseHierarchy';
import { writePrescriptionRecord, type EmosClient } from './prescriptionWriteService';

// ─── Rounding ────────────────────────────────────────────────────────────────

/** Rounding step per numeric unit. 0 = no rounding (two decimals). */
export interface RoundingRule {
  absolute_kg: number;
  percentage: number;
}

// COACH-CONFIG candidate: the smallest load change a gym can make (2.5 kg =
// a 1.25 plate each side) and whole percentage points. The CLI overrides both.
export const DEFAULT_ROUNDING: RoundingRule = { absolute_kg: 2.5, percentage: 1 };

export function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return Math.round(value * 100) / 100;
  // Divide-round-multiply, then strip floating-point dust (0.8 × 72.5 …).
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}

// ─── Pure: one prescription ──────────────────────────────────────────────────

export type ScaleSkipReason =
  | 'empty'            // no prescription on the row
  | 'non-numeric-unit' // rpe / free_text / free_text_reps / other — nothing to scale
  | 'unparsed'         // numeric unit but the grammar found no lines
  | 'no-change';       // scaling and rounding landed on the same string

export interface ScaledPrescription {
  before: string;
  /** The scaled raw string, or null when skipped. */
  after: string | null;
  skipped: ScaleSkipReason | null;
}

const NUMERIC_UNITS: ReadonlySet<string> = new Set(['absolute_kg', 'percentage']);

export function isNumericUnit(unit: string | null | undefined): unit is 'absolute_kg' | 'percentage' {
  return !!unit && NUMERIC_UNITS.has(unit);
}

/**
 * Scale every numeric load in a prescription by `factor`, preserving sets,
 * reps, ranges, the soft-load comparator, combo tuples, round multipliers
 * and quoted text loads. Percent rows scale relatively: 80 % × 0,8 = 64 %,
 * not 60 % — "20 % lighter" is a proportion of the load, not a subtraction
 * of percentage points.
 */
export function scalePrescription(
  raw: string | null,
  unit: string | null,
  isCombo: boolean,
  factor: number,
  rounding: RoundingRule = DEFAULT_ROUNDING,
): ScaledPrescription {
  const before = raw ?? '';
  if (before.trim() === '') return { before, after: null, skipped: 'empty' };
  if (!isNumericUnit(unit)) return { before, after: null, skipped: 'non-numeric-unit' };
  if (!Number.isFinite(factor) || factor <= 0) throw new Error(`scale factor must be > 0, got ${factor}`);

  const step = rounding[unit];
  const scale = (v: number) => roundToStep(v * factor, step);

  let after: string;
  if (isCombo) {
    const parsed = parseComboPrescription(before);
    if (parsed.length === 0) return { before, after: null, skipped: 'unparsed' };
    after = formatComboPrescription(
      parsed.map(line => ({
        ...line,
        load: line.loadText ? line.load : scale(line.load),
        loadMax: line.loadMax != null && !line.loadText ? scale(line.loadMax) : line.loadMax,
      })),
      unit,
    );
  } else {
    const parsed = parsePrescription(before);
    if (parsed.length === 0) return { before, after: null, skipped: 'unparsed' };
    after = formatPrescription(
      parsed.map(line => ({
        ...line,
        load: scale(line.load),
        loadMax: line.loadMax != null ? scale(line.loadMax) : null,
      })),
      unit,
    );
  }

  if (after === before) return { before, after: null, skipped: 'no-change' };
  return { before, after, skipped: null };
}

// ─── Pure: which rows the coach meant ────────────────────────────────────────

/** What the coach named. All matching is case-insensitive and trimmed. */
export interface SelectionTerms {
  /** Exercise names, codes or aliases — matched on the row's exercise and
   *  on every ancestor, so "Squat" selects "Back Squat" when it is a child. */
  names?: string[];
  /** Category names, matched on the row's own exercise only. */
  categories?: string[];
  /** Exact exercise ids. */
  ids?: string[];
}

export interface SelectableExercise {
  id: string;
  name: string;
  exercise_code: string | null;
  aliases: string[] | null;
  category: string | null;
  parent_exercise_id: string | null;
}

export interface TermMatch {
  matched: boolean;
  /** Human-readable why, e.g. `name "Back Squat"`, `ancestor "Squat"`, `category "Squat"`. */
  via: string | null;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

function nameMatches(ex: SelectableExercise, terms: Set<string>): boolean {
  if (terms.has(norm(ex.name))) return true;
  if (ex.exercise_code && terms.has(norm(ex.exercise_code))) return true;
  return (ex.aliases ?? []).some(a => terms.has(norm(a)));
}

/**
 * Does an exercise (by id) match the coach's terms? Walks the ancestor chain
 * through the shared hierarchy resolver, so a child variation is selected by
 * its parent's name. Category is checked on the exercise itself only — a
 * child inherits its parent's *name* match, not the category label, which
 * coaches set per row.
 */
export function matchExerciseTerms(
  exerciseId: string,
  exercisesById: Map<string, SelectableExercise>,
  parentIndex: ParentIndex,
  terms: SelectionTerms,
): TermMatch {
  const ids = new Set((terms.ids ?? []).map(norm));
  const names = new Set((terms.names ?? []).map(norm));
  const cats = new Set((terms.categories ?? []).map(norm));

  const self = exercisesById.get(exerciseId);
  if (!self) return { matched: false, via: null };
  if (ids.has(norm(self.id))) return { matched: true, via: `id ${self.id}` };
  if (names.size > 0 && nameMatches(self, names)) return { matched: true, via: `name "${self.name}"` };
  if (cats.size > 0 && cats.has(norm(self.category))) return { matched: true, via: `category "${self.category}"` };

  // resolveAncestorPath returns [self, parent, grandparent, …] with a cycle guard.
  for (const ancestorId of resolveAncestorPath(exerciseId, parentIndex).slice(1)) {
    const anc = exercisesById.get(ancestorId);
    if (!anc) continue;
    if (ids.has(norm(anc.id))) return { matched: true, via: `ancestor id ${anc.id}` };
    if (names.size > 0 && nameMatches(anc, names)) return { matched: true, via: `ancestor "${anc.name}"` };
  }
  return { matched: false, via: null };
}

// ─── Supabase: a whole week ──────────────────────────────────────────────────

export interface ScaleWeekOptions {
  weekPlanId: string;
  factor: number;
  selection: SelectionTerms;
  /** Restrict to these day indexes (0 = the week's first slot). */
  days?: number[];
  /** Scale combo rows whose members match. Off by default: a combo that
   *  contains a squat also contains the other lift, and halving both is a
   *  decision the coach makes explicitly. */
  includeCombos?: boolean;
  rounding?: RoundingRule;
  /** Write the change set. Default false — a dry run. */
  apply?: boolean;
}

export type ChangeStatus = 'change' | 'skip';

export interface LoadChange {
  plannedExerciseId: string;
  dayIndex: number;
  position: number;
  label: string;
  unit: string | null;
  isCombo: boolean;
  before: string;
  after: string | null;
  status: ChangeStatus;
  /** Why the row was selected. */
  via: string;
  /** Why the row was skipped (status 'skip'). */
  skipReason: ScaleSkipReason | 'combo-excluded' | null;
}

export interface ScaleWeekResult {
  weekPlan: WeekPlan;
  factor: number;
  /** Selected rows only, in day/position order. Unselected rows are not listed. */
  changes: LoadChange[];
  /** Rows actually written (0 on a dry run). */
  applied: number;
}

interface PlannedRowLite {
  id: string;
  day_index: number;
  position: number;
  exercise_id: string;
  unit: string | null;
  prescription_raw: string | null;
  display_name: string | null;
  is_combo: boolean;
  combo_notation: string | null;
}

/**
 * Load every exercise the given ids reference plus all their ancestors, in as
 * few round trips as the tree is deep. Owner-agnostic on purpose: shared
 * catalogues can put an exercise and its parent under different owners.
 */
export async function loadExerciseClosure(
  client: EmosClient,
  seedIds: Iterable<string>,
): Promise<Map<string, SelectableExercise>> {
  const out = new Map<string, SelectableExercise>();
  let pending = [...new Set(seedIds)];
  let guard = 0;
  while (pending.length > 0 && guard++ < 32) {
    const { data, error } = await client
      .from('exercises')
      .select('id, name, exercise_code, aliases, category, parent_exercise_id')
      .in('id', pending);
    if (error) throw error;
    const rows = (data as unknown as SelectableExercise[]) ?? [];
    for (const r of rows) out.set(r.id, r);
    pending = rows
      .map(r => r.parent_exercise_id)
      .filter((p): p is string => !!p && !out.has(p));
  }
  return out;
}

export async function scaleWeekLoads(
  client: EmosClient,
  opts: ScaleWeekOptions,
): Promise<ScaleWeekResult> {
  const rounding = opts.rounding ?? DEFAULT_ROUNDING;
  if (!Number.isFinite(opts.factor) || opts.factor <= 0) {
    throw new Error(`scale factor must be > 0, got ${opts.factor}`);
  }

  const { data: planRaw, error: planErr } = await client
    .from('week_plans')
    .select('*')
    .eq('id', opts.weekPlanId)
    .single();
  if (planErr) throw planErr;
  const weekPlan = planRaw as unknown as WeekPlan;
  if (weekPlan.is_group_plan || weekPlan.group_id) {
    throw new Error(
      `week ${weekPlan.week_start} is a GROUP plan — scale it in the planner and sync, so the athletes receive it`,
    );
  }

  const { data: rowsRaw, error: rowsErr } = await client
    .from('planned_exercises')
    .select('id, day_index, position, exercise_id, unit, prescription_raw, display_name, is_combo, combo_notation')
    .eq('weekplan_id', weekPlan.id)
    .order('day_index')
    .order('position');
  if (rowsErr) throw rowsErr;
  let rows = (rowsRaw as unknown as PlannedRowLite[]) ?? [];
  if (opts.days && opts.days.length > 0) {
    const days = new Set(opts.days);
    rows = rows.filter(r => days.has(r.day_index));
  }

  // Combo members, so a combo can be selected by any of its lifts.
  const membersByRow = new Map<string, string[]>();
  const comboIds = rows.filter(r => r.is_combo).map(r => r.id);
  if (comboIds.length > 0) {
    const { data: mem, error: memErr } = await client
      .from('planned_exercise_combo_members')
      .select('planned_exercise_id, exercise_id, position')
      .in('planned_exercise_id', comboIds)
      .order('position');
    if (memErr) throw memErr;
    for (const m of (mem as unknown as { planned_exercise_id: string; exercise_id: string }[]) ?? []) {
      const list = membersByRow.get(m.planned_exercise_id) ?? [];
      list.push(m.exercise_id);
      membersByRow.set(m.planned_exercise_id, list);
    }
  }

  const seed = new Set<string>();
  for (const r of rows) seed.add(r.exercise_id);
  for (const ids of membersByRow.values()) for (const id of ids) seed.add(id);
  const exercises = await loadExerciseClosure(client, seed);
  const parentIndex = buildParentIndex(exercises.values());

  const changes: LoadChange[] = [];
  for (const row of rows) {
    const candidates = row.is_combo
      ? [...new Set([row.exercise_id, ...(membersByRow.get(row.id) ?? [])])]
      : [row.exercise_id];
    let via: string | null = null;
    for (const id of candidates) {
      const m = matchExerciseTerms(id, exercises, parentIndex, opts.selection);
      if (m.matched) { via = m.via; break; }
    }
    if (!via) continue;

    const label =
      row.display_name
      ?? (row.is_combo ? row.combo_notation : null)
      ?? exercises.get(row.exercise_id)?.name
      ?? row.exercise_id;

    if (row.is_combo && !opts.includeCombos) {
      changes.push({
        plannedExerciseId: row.id, dayIndex: row.day_index, position: row.position, label,
        unit: row.unit, isCombo: true, before: row.prescription_raw ?? '', after: null,
        status: 'skip', via, skipReason: 'combo-excluded',
      });
      continue;
    }

    const scaled = scalePrescription(row.prescription_raw, row.unit, row.is_combo, opts.factor, rounding);
    changes.push({
      plannedExerciseId: row.id, dayIndex: row.day_index, position: row.position, label,
      unit: row.unit, isCombo: row.is_combo, before: scaled.before, after: scaled.after,
      status: scaled.after ? 'change' : 'skip', via, skipReason: scaled.skipped,
    });
  }

  let applied = 0;
  if (opts.apply) {
    for (const c of changes) {
      if (c.status !== 'change' || c.after == null) continue;
      await writePrescriptionRecord(client, c.plannedExerciseId, {
        prescription: c.after,
        unit: c.unit as DefaultUnit,
        isCombo: c.isCombo,
      });
      applied++;
    }
  }

  return { weekPlan, factor: opts.factor, changes, applied };
}
