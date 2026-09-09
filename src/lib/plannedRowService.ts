// Create a week and add / remove single planned rows — the verbs behind
// "start on Asger's next week", "back squat: 87.5×5, 100×5, 115×5-10" and
// "goodmorning + push press, 2+2 × 6".
//
// Mirrors the planner's own paths: `ensureIndividualWeek` is
// `fetchOrCreateWeekPlan` + `fetchPreviousWeekRhythm` (a new week inherits
// the day structure of the athlete's most recent week), `addPlannedExercise`
// is `addExerciseToDay` + the shared prescription write, and
// `addPlannedCombo` is `createComboExercise` + the same write with
// `isCombo`, so summary and set-line caches are built exactly as a planner
// edit would build them.
//
// Takes the Supabase client as an argument; no React, no stores. Used by
// scripts/emos-cli.ts.

import type {
  DefaultUnit, WeekPlan, GppSection, GppRow, ExerciseFeatures, PlannedExerciseMetadata,
} from './database.types';
import { detectIntendedUnit, parseComboPrescription, computePrescriptionSummary } from './prescriptionParser';
import { applyFeatureOverrides, parseTimeInput, parseTempoInput } from './exerciseFeatures';
import { writePrescriptionRecord, replaceSetLines, type EmosClient } from './prescriptionWriteService';
import { SENTINEL_DEFS } from '../components/planner/sentinelUtils';

// ─── Pure helpers ────────────────────────────────────────────────────────────

const UNIT_ALIASES: Record<string, DefaultUnit> = {
  kg: 'absolute_kg', absolute_kg: 'absolute_kg', abs: 'absolute_kg',
  '%': 'percentage', pct: 'percentage', percent: 'percentage', percentage: 'percentage',
  rpe: 'rpe',
  free: 'free_text', free_text: 'free_text', text: 'free_text',
  'free-reps': 'free_text_reps', free_reps: 'free_text_reps', free_text_reps: 'free_text_reps',
  other: 'other',
};

/** `kg` / `%` / `rpe` / `free` / `free-reps` / `other` → the stored unit. Null when unknown. */
export function resolveUnitAlias(input: string | null | undefined): DefaultUnit | null {
  if (!input) return null;
  return UNIT_ALIASES[input.trim().toLowerCase()] ?? null;
}

/**
 * The unit a new row should carry: the coach's explicit choice, else what
 * the prescription text implies (a `%` sign, letters), else the exercise's
 * default. A `%` in the text always wins over a `kg` default — that is the
 * planner's own auto-detect rule.
 */
export function chooseUnit(
  explicit: DefaultUnit | null,
  prescription: string | null,
  exerciseDefault: DefaultUnit,
): DefaultUnit {
  if (explicit) return explicit;
  const detected = prescription ? detectIntendedUnit(prescription) : null;
  if (detected === 'percentage') return 'percentage';
  if (detected === 'free_text_reps' && exerciseDefault !== 'free_text' && exerciseDefault !== 'other') return 'free_text_reps';
  return exerciseDefault;
}

/** The planner's default combo colour (ComboCreatorModal's first swatch). */
export const DEFAULT_COMBO_COLOR = '#3B82F6';

/** The label a combo gets when the coach names none: member names joined with ' + ', as the planner does. */
export function comboAutoNotation(memberNames: string[]): string {
  return memberNames.join(' + ');
}

export type ComboPrescriptionCheck =
  | { ok: true; /** Members per set in the first segment's reps tuple (`1+2` → 2). */ arity: number }
  | { ok: false; reason: string };

/**
 * Pure: whether a raw string reads as a combo prescription, and how many
 * members its reps tuple names. A combo row's cache is built by
 * `parseComboPrescription`, so a string it cannot read would store a row
 * with no set lines; a tuple whose arity differs from the member count is
 * legal (the planner allows it) but almost always a typo, so the caller can
 * warn on it.
 */
export function checkComboPrescription(raw: string): ComboPrescriptionCheck {
  const lines = parseComboPrescription(raw);
  if (lines.length === 0) {
    return { ok: false, reason: `"${raw}" is not a combo prescription — write load×reps-tuple×sets, e.g. 80×1+2×3 or Moderat×2+2×6` };
  }
  const arity = lines[0].repsText.split('+').length;
  return { ok: true, arity };
}

export interface PickableExercise {
  id: string;
  name: string;
  exercise_code: string | null;
  aliases: string[] | null;
  owner_id: string;
  is_archived: boolean;
}

export type ExercisePick<T extends PickableExercise> =
  | { kind: 'one'; exercise: T }
  | { kind: 'many'; candidates: T[] }
  | { kind: 'none' };

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export interface PickPreferences {
  /** Exercises this coach has actually planned before — the strongest tie-break. */
  preferIds?: ReadonlySet<string>;
  /** The athlete's owner: a personal row beats a club duplicate. */
  preferOwnerId?: string;
}

/**
 * Pick the exercise the coach named: an id, else an exact name / code /
 * alias match, else a unique substring of the name. On a tie, exercises the
 * coach has planned before win, then the athlete owner's own rows, so a club
 * catalogue duplicate never hijacks the one in use. Archived rows are only
 * considered when nothing live matches. Still ambiguous → 'many': the CLI
 * lists the candidates and the assistant asks rather than guesses.
 */
export function pickExercise<T extends PickableExercise>(
  term: string,
  candidates: T[],
  prefs: PickPreferences = {},
): ExercisePick<T> {
  const { preferIds, preferOwnerId } = prefs;
  const t = norm(term);
  if (!t) return { kind: 'none' };
  const byId = candidates.find(c => c.id.toLowerCase() === t);
  if (byId) return { kind: 'one', exercise: byId };

  const tiers: Array<(c: T) => boolean> = [
    c => norm(c.name) === t || norm(c.exercise_code) === t || (c.aliases ?? []).some(a => norm(a) === t),
    c => norm(c.name).includes(t),
  ];
  const live = candidates.filter(c => !c.is_archived);
  for (const pool of [live, candidates]) {
    for (const test of tiers) {
      let hits = pool.filter(test);
      if (hits.length === 0) continue;
      if (hits.length > 1 && preferIds) {
        const used = hits.filter(h => preferIds.has(h.id));
        if (used.length >= 1) hits = used;
      }
      if (hits.length > 1 && preferOwnerId) {
        const own = hits.filter(h => h.owner_id === preferOwnerId);
        if (own.length >= 1) hits = own;
      }
      if (hits.length === 1) return { kind: 'one', exercise: hits[0] };
      return { kind: 'many', candidates: hits };
    }
  }
  return { kind: 'none' };
}

// ─── Weeks ───────────────────────────────────────────────────────────────────

type Rhythm = Pick<WeekPlan, 'active_days' | 'day_labels' | 'day_display_order' | 'day_schedule'>;

export interface EnsureWeekParams {
  athleteId: string;
  /** Monday ISO of the week to create or find. */
  weekStart: string;
  /** Take the day structure (active days, labels, order, schedule) from this
   *  week instead of the athlete's most recent week before `weekStart`. */
  likeWeekStart?: string;
  /** Coach recorded as `last_edited_by_coach_id`. Defaults to the athlete's owner. */
  editorCoachId?: string;
}

export interface EnsureWeekResult {
  weekPlan: WeekPlan;
  created: boolean;
  /** Which week the day structure came from (null = table defaults). */
  rhythmFrom: string | null;
}

async function fetchIndividualPlan(client: EmosClient, athleteId: string, weekStart: string): Promise<WeekPlan | null> {
  const { data, error } = await client
    .from('week_plans')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .is('group_id', null)
    .maybeSingle();
  if (error) throw error;
  return (data as WeekPlan | null) ?? null;
}

/** Find an athlete's existing individual week, or create it empty. */
export async function ensureIndividualWeek(client: EmosClient, params: EnsureWeekParams): Promise<EnsureWeekResult> {
  const existing = await fetchIndividualPlan(client, params.athleteId, params.weekStart);
  if (existing) return { weekPlan: existing, created: false, rhythmFrom: null };

  const { data: athleteRow, error: athErr } = await client
    .from('athletes')
    .select('owner_id')
    .eq('id', params.athleteId)
    .single();
  if (athErr) throw athErr;
  const ownerId = (athleteRow as { owner_id: string }).owner_id;

  // Day structure: the named week, else the most recent week before the target.
  let rhythm: Rhythm | null = null;
  let rhythmFrom: string | null = null;
  let q = client
    .from('week_plans')
    .select('week_start, active_days, day_labels, day_display_order, day_schedule')
    .eq('athlete_id', params.athleteId)
    .is('group_id', null);
  q = params.likeWeekStart
    ? q.eq('week_start', params.likeWeekStart)
    : q.lt('week_start', params.weekStart).order('week_start', { ascending: false });
  const { data: prevRows } = await q.limit(1);
  const prev = (prevRows as unknown as (Rhythm & { week_start: string })[] | null)?.[0];
  if (prev?.active_days?.length) {
    rhythm = {
      active_days: prev.active_days,
      day_labels: prev.day_labels ?? null,
      day_display_order: prev.day_display_order ?? null,
      day_schedule: prev.day_schedule ?? null,
    };
    rhythmFrom = prev.week_start;
  }

  const { data: created, error: createErr } = await client
    .from('week_plans')
    .insert([{
      week_start: params.weekStart,
      athlete_id: params.athleteId,
      group_id: null,
      is_group_plan: false,
      owner_id: ownerId,
      last_edited_by_coach_id: params.editorCoachId ?? ownerId,
      ...(rhythm ?? {}),
    }])
    .select()
    .single();
  if (createErr) throw createErr;
  return { weekPlan: created as WeekPlan, created: true, rhythmFrom };
}

// ─── Rows ────────────────────────────────────────────────────────────────────

export interface AddRowParams {
  weekPlanId: string;
  /** Slot number, 1-based and unbounded (DISPLAY_CONVENTIONS §4): D1 = 1. */
  dayIndex: number;
  exerciseId: string;
  unit: DefaultUnit;
  /** Raw prescription in the grammar; null leaves the row empty. */
  prescription: string | null;
  notes?: string | null;
  displayName?: string | null;
  /** Explicit position; default appends after the day's last row. */
  position?: number | null;
}

export interface AddRowResult {
  plannedExerciseId: string;
  position: number;
  /** True when the day was not active on the week and has been switched on. */
  dayActivated: boolean;
}

type PlanForWrite = Pick<WeekPlan, 'id' | 'active_days' | 'is_group_plan' | 'group_id'>;

/** The week a row is written to — refused when it is a group plan or the slot is not a number. */
async function loadPlanForWrite(client: EmosClient, weekPlanId: string, dayIndex: number): Promise<PlanForWrite> {
  const { data: planRaw, error: planErr } = await client
    .from('week_plans')
    .select('id, active_days, is_group_plan, group_id')
    .eq('id', weekPlanId)
    .single();
  if (planErr) throw planErr;
  const plan = planRaw as unknown as PlanForWrite;
  if (plan.is_group_plan || plan.group_id) {
    throw new Error('this is a GROUP plan — add the row in the planner and sync, so the athletes receive it');
  }
  if (!Number.isInteger(dayIndex) || dayIndex < 1) {
    throw new Error(`day slot must be a positive integer (D1 = 1), got ${dayIndex}`);
  }
  return plan;
}

/** The explicit position, else one past the day's last row. */
async function resolvePosition(client: EmosClient, weekPlanId: string, dayIndex: number, explicit: number | null | undefined): Promise<number> {
  if (explicit != null) return explicit;
  const { data } = await client
    .from('planned_exercises')
    .select('position')
    .eq('weekplan_id', weekPlanId)
    .eq('day_index', dayIndex)
    .order('position', { ascending: false })
    .limit(1);
  return (((data as { position: number }[] | null)?.[0]?.position) ?? 0) + 1;
}

/**
 * A row on an inactive slot would be an orphan the grid never shows. Called
 * after the insert so a refused row leaves the week untouched. Returns true
 * when the slot was switched on.
 */
async function activateDay(client: EmosClient, plan: PlanForWrite, dayIndex: number): Promise<boolean> {
  const active = plan.active_days ?? [];
  if (active.includes(dayIndex)) return false;
  const { error } = await client
    .from('week_plans')
    .update({ active_days: [...active, dayIndex].sort((a, b) => a - b) })
    .eq('id', plan.id);
  if (error) throw error;
  return true;
}

export async function addPlannedExercise(client: EmosClient, p: AddRowParams): Promise<AddRowResult> {
  const plan = await loadPlanForWrite(client, p.weekPlanId, p.dayIndex);
  const position = await resolvePosition(client, p.weekPlanId, p.dayIndex, p.position);

  const { data: inserted, error: insErr } = await client
    .from('planned_exercises')
    .insert([{
      weekplan_id: p.weekPlanId,
      day_index: p.dayIndex,
      exercise_id: p.exerciseId,
      position,
      unit: p.unit,
      prescription_raw: null,
      summary_total_sets: 0,
      summary_total_reps: 0,
      summary_highest_load: null,
      summary_avg_load: null,
      notes: p.notes ?? null,
      display_name: p.displayName ?? null,
      is_combo: false,
      source: 'individual' as const,
    }])
    .select('id')
    .single();
  if (insErr) throw insErr;
  const id = (inserted as { id: string }).id;

  if (p.prescription && p.prescription.trim() !== '') {
    await writePrescriptionRecord(client, id, { prescription: p.prescription.trim(), unit: p.unit });
  }

  const dayActivated = await activateDay(client, plan, p.dayIndex);
  return { plannedExerciseId: id, position, dayActivated };
}

export interface ComboMember {
  exerciseId: string;
  /** Used for the automatic notation only; never stored. */
  name: string;
}

export interface AddComboParams {
  weekPlanId: string;
  /** Slot number, 1-based and unbounded (DISPLAY_CONVENTIONS §4): D1 = 1. */
  dayIndex: number;
  /** In lifting order; at least two. The first is the row's `exercise_id`, as the planner stores it. */
  members: ComboMember[];
  unit: DefaultUnit;
  /** Raw combo prescription (`80×1+2×3`); null leaves the row empty. */
  prescription: string | null;
  /** The combo's label (`combo_notation`); default = member names joined with ' + '. */
  notation?: string | null;
  /** Hex colour for the combo chip; default the planner's first swatch. */
  color?: string | null;
  notes?: string | null;
  /** Explicit position; default appends after the day's last row. */
  position?: number | null;
}

export interface AddComboResult extends AddRowResult {
  notation: string;
  color: string;
}

/**
 * Add a combo row — one `planned_exercises` line whose members live in
 * `planned_exercise_combo_members` — the way the planner's combo creator
 * does: the first member is the row's exercise, the notation and colour sit
 * on the row, and the prescription goes through the shared write with
 * `isCombo` so the set-line cache carries the reps tuple.
 */
export async function addPlannedCombo(client: EmosClient, p: AddComboParams): Promise<AddComboResult> {
  if (p.members.length < 2) throw new Error('a combo needs at least two member exercises');
  const prescription = p.prescription?.trim() || null;
  if (prescription) {
    const check = checkComboPrescription(prescription);
    if (!check.ok) throw new Error(check.reason);
  }
  const plan = await loadPlanForWrite(client, p.weekPlanId, p.dayIndex);
  const position = await resolvePosition(client, p.weekPlanId, p.dayIndex, p.position);
  const notation = p.notation?.trim() || comboAutoNotation(p.members.map(m => m.name));
  const color = p.color?.trim() || DEFAULT_COMBO_COLOR;

  const { data: inserted, error: insErr } = await client
    .from('planned_exercises')
    .insert([{
      weekplan_id: p.weekPlanId,
      day_index: p.dayIndex,
      exercise_id: p.members[0].exerciseId,
      position,
      unit: p.unit,
      prescription_raw: null,
      summary_total_sets: 0,
      summary_total_reps: 0,
      summary_highest_load: null,
      summary_avg_load: null,
      notes: p.notes ?? null,
      is_combo: true,
      combo_notation: notation,
      combo_color: color,
      source: 'individual' as const,
    }])
    .select('id')
    .single();
  if (insErr) throw insErr;
  const id = (inserted as { id: string }).id;

  const { error: membersErr } = await client
    .from('planned_exercise_combo_members')
    .insert(p.members.map((m, i) => ({ planned_exercise_id: id, exercise_id: m.exerciseId, position: i + 1 })));
  if (membersErr) throw membersErr;

  if (prescription) {
    await writePrescriptionRecord(client, id, { prescription, unit: p.unit, isCombo: true });
  }

  const dayActivated = await activateDay(client, plan, p.dayIndex);
  return { plannedExerciseId: id, position, dayActivated, notation, color };
}

/** Delete one planned row with its set lines and combo members. Returns what it removed. */
export async function removePlannedExercise(
  client: EmosClient,
  plannedExerciseId: string,
): Promise<{ removed: boolean; weekPlanId: string | null; dayIndex: number | null }> {
  const { data: row } = await client
    .from('planned_exercises')
    .select('id, weekplan_id, day_index')
    .eq('id', plannedExerciseId)
    .maybeSingle();
  if (!row) return { removed: false, weekPlanId: null, dayIndex: null };
  const r = row as unknown as { weekplan_id: string; day_index: number };
  for (const table of ['planned_set_lines', 'planned_exercise_combo_members'] as const) {
    const { error } = await client.from(table).delete().eq('planned_exercise_id', plannedExerciseId);
    if (error) throw error;
  }
  const { error } = await client.from('planned_exercises').delete().eq('id', plannedExerciseId);
  if (error) throw error;
  return { removed: true, weekPlanId: r.weekplan_id, dayIndex: r.day_index };
}

// ─── Editing a row in place ──────────────────────────────────────────────────
//
// What the coach does most, by the planner's own data: copy last week, then
// change prescriptions where they stand (534 of 1336 same-slot rows in a
// season), swap the exercise in a slot (720 rows), set a time budget on a
// block (236 rows) and write a note (625 rows). Each mirrors the planner's
// own path — savePrescription, saveNotes, saveExerciseFeatures,
// swapPlannedExercise, moveExercise / reorderInDay — so the caches stay right.

/** A feature patch: a value sets the key, `null` removes it, absent leaves it. */
export interface FeaturePatch {
  totalTime?: number | null;
  restTime?: number | null;
  tempo?: string | null;
  totalReps?: number | null;
  totalSets?: number | null;
}

/** Pure: the features bag after a patch; an empty bag becomes undefined so the JSON stays tidy. */
export function applyFeaturePatch(
  current: ExerciseFeatures | undefined | null,
  patch: FeaturePatch,
): ExerciseFeatures | undefined {
  const next: ExerciseFeatures = { ...(current ?? {}) };
  for (const key of Object.keys(patch) as (keyof FeaturePatch)[]) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null) delete next[key];
    else (next as Record<string, unknown>)[key] = v;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Pure: the coach's flag values → a feature patch. Durations take the
 * planner's own grammar (`12` minutes, `90s`, `2:15`); `off` removes the
 * feature. Returns the first unreadable value as an error.
 */
export function parseFeatureFlags(flags: {
  time?: string; rest?: string; tempo?: string; totalReps?: string; totalSets?: string;
}): { ok: true; patch: FeaturePatch } | { ok: false; reason: string } {
  const patch: FeaturePatch = {};
  const isOff = (v: string) => /^(off|none|clear|-)$/i.test(v.trim());
  const duration = (key: 'totalTime' | 'restTime', flag: string, v: string | undefined) => {
    if (v == null) return null;
    if (isOff(v)) { patch[key] = null; return null; }
    const sec = parseTimeInput(v);
    if (sec == null) return `--${flag} "${v}" is not a duration — use minutes (12), seconds (90s) or m:ss (2:15), or off`;
    patch[key] = sec;
    return null;
  };
  const count = (key: 'totalReps' | 'totalSets', flag: string, v: string | undefined) => {
    if (v == null) return null;
    if (isOff(v)) { patch[key] = null; return null; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return `--${flag} must be a whole number or off (got "${v}")`;
    patch[key] = n;
    return null;
  };
  const err = duration('totalTime', 'time', flags.time)
    ?? duration('restTime', 'rest', flags.rest)
    ?? count('totalReps', 'total-reps', flags.totalReps)
    ?? count('totalSets', 'total-sets', flags.totalSets);
  if (err) return { ok: false, reason: err };
  if (flags.tempo != null) {
    if (isOff(flags.tempo)) patch.tempo = null;
    else {
      const t = parseTempoInput(flags.tempo);
      if (!t) return { ok: false, reason: `--tempo "${flags.tempo}" is not four digits (eccentric-pause-concentric-pause, e.g. 3120 or 3-1-2-0), or off` };
      patch.tempo = t;
    }
  }
  return { ok: true, patch };
}

export interface EditRowParams {
  plannedExerciseId: string;
  /** New raw prescription; '' clears the prescription and its set lines. Absent = unchanged. */
  prescription?: string;
  /** Explicit unit; with a new prescription and no unit, the text decides (a `%`, letters) else the row keeps its unit. */
  unit?: DefaultUnit | null;
  /** New note; '' or null clears it. Absent = unchanged. */
  notes?: string | null;
  /** New label override; '' or null clears it. Absent = unchanged. */
  displayName?: string | null;
  features?: FeaturePatch;
}

export interface EditRowResult {
  plannedExerciseId: string;
  changed: string[];
  unit: DefaultUnit | null;
  prescription: string | null;
  features: ExerciseFeatures | undefined;
}

type EditableRow = {
  id: string; weekplan_id: string; unit: DefaultUnit | null; prescription_raw: string | null;
  is_combo: boolean; metadata: PlannedExerciseMetadata | null; notes: string | null; display_name: string | null;
  exercise_id: string; source: string | null;
};

async function loadEditableRow(client: EmosClient, id: string): Promise<EditableRow> {
  const { data, error } = await client
    .from('planned_exercises')
    .select('id, weekplan_id, unit, prescription_raw, is_combo, metadata, notes, display_name, exercise_id, source')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`no planned row with id ${id}`);
  const row = data as unknown as EditableRow;
  const { data: plan, error: pErr } = await client
    .from('week_plans')
    .select('is_group_plan, group_id')
    .eq('id', row.weekplan_id)
    .single();
  if (pErr) throw pErr;
  const p = plan as unknown as Pick<WeekPlan, 'is_group_plan' | 'group_id'>;
  if (p.is_group_plan || p.group_id) {
    throw new Error('this row is on a GROUP plan — edit it in the planner and sync, so the athletes receive it');
  }
  return row;
}

/** The planner's rule: a coach edit turns a group-sourced row individual. */
async function promoteToIndividual(client: EmosClient, id: string): Promise<void> {
  const { error } = await client
    .from('planned_exercises')
    .update({ source: 'individual' })
    .eq('id', id)
    .eq('source', 'group');
  if (error) throw error;
}

/**
 * Edit one planned row where it stands. Each part is the planner's own
 * write: the prescription through the shared write (summary + set lines +
 * overrides), the note folding `variation_note` away, the features bag
 * read-modify-written so gpp / athleteHidden survive, with the summary
 * re-derived so Σ overrides take effect where summary_* is read.
 */
export async function editPlannedExercise(client: EmosClient, p: EditRowParams): Promise<EditRowResult> {
  const row = await loadEditableRow(client, p.plannedExerciseId);
  const changed: string[] = [];
  let features = row.metadata?.features;
  let unit = row.unit;
  let prescription = row.prescription_raw;

  if (p.notes !== undefined) {
    const notes = p.notes?.trim() || null;
    const { error } = await client
      .from('planned_exercises')
      .update({ notes, variation_note: null })
      .eq('id', row.id);
    if (error) throw error;
    changed.push(notes ? 'note' : 'note cleared');
  }

  if (p.displayName !== undefined) {
    const display_name = p.displayName?.trim() || null;
    const { error } = await client.from('planned_exercises').update({ display_name }).eq('id', row.id);
    if (error) throw error;
    changed.push(display_name ? 'display name' : 'display name cleared');
  }

  if (p.features && Object.values(p.features).some(v => v !== undefined)) {
    features = applyFeaturePatch(row.metadata?.features, p.features);
    const meta: Record<string, unknown> = { ...(row.metadata ?? {}) };
    if (features) meta.features = features; else delete meta.features;
    const summary = applyFeatureOverrides(
      computePrescriptionSummary(row.prescription_raw ?? '', row.unit, row.is_combo),
      features,
    );
    const { error } = await client
      .from('planned_exercises')
      .update({
        metadata: meta as PlannedExerciseMetadata,
        summary_total_sets: summary.total_sets,
        summary_total_reps: summary.total_reps,
        summary_highest_load: summary.highest_load,
        summary_avg_load: summary.avg_load,
      })
      .eq('id', row.id);
    if (error) throw error;
    changed.push('features');
  }

  if (p.prescription !== undefined) {
    const raw = p.prescription.trim();
    if (raw === '') {
      await replaceSetLines(client, row.id, []);
      const { error } = await client
        .from('planned_exercises')
        .update({
          prescription_raw: null,
          summary_total_sets: 0, summary_total_reps: 0, summary_highest_load: null, summary_avg_load: null,
        })
        .eq('id', row.id);
      if (error) throw error;
      prescription = null;
      changed.push('prescription cleared');
    } else {
      if (row.is_combo) {
        const check = checkComboPrescription(raw);
        if (!check.ok) throw new Error(check.reason);
      }
      unit = p.unit ?? chooseUnit(null, raw, row.unit ?? 'absolute_kg');
      await writePrescriptionRecord(client, row.id, { prescription: raw, unit, isCombo: row.is_combo });
      prescription = raw;
      changed.push('prescription');
    }
  } else if (p.unit != null && p.unit !== row.unit) {
    unit = p.unit;
    if (row.prescription_raw) {
      await writePrescriptionRecord(client, row.id, { prescription: row.prescription_raw, unit, isCombo: row.is_combo });
    } else {
      const { error } = await client.from('planned_exercises').update({ unit }).eq('id', row.id);
      if (error) throw error;
    }
    changed.push('unit');
  }

  if (changed.length > 0) await promoteToIndividual(client, row.id);
  return { plannedExerciseId: row.id, changed, unit, prescription, features };
}

/**
 * Put another exercise in a row's place, keeping prescription, note, unit
 * and position — the planner's swapPlannedExercise. Refused on a combo row:
 * its exercise is the first member, and the members are edited as a set.
 */
export async function swapPlannedExercise(
  client: EmosClient,
  plannedExerciseId: string,
  newExerciseId: string,
): Promise<{ plannedExerciseId: string; from: string; to: string }> {
  const row = await loadEditableRow(client, plannedExerciseId);
  if (row.is_combo) throw new Error('this row is a combo — its members are edited together in the planner (or remove it and add-combo)');
  if (row.metadata?.gpp) throw new Error('this row is a GPP block, not an exercise — use edit-gpp');
  const { error } = await client.from('planned_exercises').update({ exercise_id: newExerciseId }).eq('id', row.id);
  if (error) throw error;
  await promoteToIndividual(client, row.id);
  return { plannedExerciseId: row.id, from: row.exercise_id, to: newExerciseId };
}

export interface MoveRowParams {
  plannedExerciseId: string;
  /** Target slot; absent = stay on the row's day. */
  dayIndex?: number | null;
  /** Target position among the day's rows (1 = first); absent = append when the day changes, else unchanged. */
  position?: number | null;
}

export interface MoveRowResult {
  plannedExerciseId: string;
  from: { dayIndex: number; position: number };
  to: { dayIndex: number; position: number };
  dayActivated: boolean;
}

/**
 * Move a row to another slot and/or another place in its day — the
 * planner's moveExercise (append to the target day, renumber both days
 * through the `normalize_planned_exercise_positions` RPC) followed by its
 * reorderInDay (the row lands at the asked position, siblings shift).
 */
export async function movePlannedExercise(client: EmosClient, p: MoveRowParams): Promise<MoveRowResult> {
  const { data, error } = await client
    .from('planned_exercises')
    .select('id, weekplan_id, day_index, position')
    .eq('id', p.plannedExerciseId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`no planned row with id ${p.plannedExerciseId}`);
  const row = data as unknown as { id: string; weekplan_id: string; day_index: number; position: number };
  const targetDay = p.dayIndex ?? row.day_index;
  const plan = await loadPlanForWrite(client, row.weekplan_id, targetDay);
  if (p.position != null && (!Number.isInteger(p.position) || p.position < 1)) {
    throw new Error(`position must be a positive integer (got ${p.position})`);
  }
  if (targetDay === row.day_index && p.position == null) {
    return { plannedExerciseId: row.id, from: { dayIndex: row.day_index, position: row.position }, to: { dayIndex: row.day_index, position: row.position }, dayActivated: false };
  }

  if (targetDay !== row.day_index) {
    const { data: toRows } = await client
      .from('planned_exercises')
      .select('id')
      .eq('weekplan_id', row.weekplan_id)
      .eq('day_index', targetDay);
    const appendAt = ((toRows as unknown[] | null)?.length ?? 0) + 1;
    const { error: mvErr } = await client
      .from('planned_exercises')
      .update({ day_index: targetDay, position: appendAt })
      .eq('id', row.id);
    if (mvErr) throw mvErr;
    for (const day of [row.day_index, targetDay]) {
      const { error: nErr } = await client.rpc('normalize_planned_exercise_positions', {
        p_weekplan_id: row.weekplan_id, p_day_index: day,
      });
      if (nErr) throw nErr;
    }
  }

  let finalPosition: number;
  const { data: siblings, error: sErr } = await client
    .from('planned_exercises')
    .select('id, position')
    .eq('weekplan_id', row.weekplan_id)
    .eq('day_index', targetDay)
    .order('position');
  if (sErr) throw sErr;
  const ids = ((siblings as unknown as { id: string }[]) ?? []).map(r => r.id);
  if (p.position != null) {
    const without = ids.filter(id => id !== row.id);
    const at = Math.max(0, Math.min(without.length, p.position - 1));
    without.splice(at, 0, row.id);
    for (let i = 0; i < without.length; i++) {
      if (ids[i] === without[i]) continue;
      const { error: uErr } = await client.from('planned_exercises').update({ position: i + 1 }).eq('id', without[i]);
      if (uErr) throw uErr;
    }
    finalPosition = at + 1;
  } else {
    finalPosition = ids.indexOf(row.id) + 1;
  }

  const dayActivated = await activateDay(client, plan, targetDay);
  return {
    plannedExerciseId: row.id,
    from: { dayIndex: row.day_index, position: row.position },
    to: { dayIndex: targetDay, position: finalPosition },
    dayActivated,
  };
}

// ─── GPP blocks ──────────────────────────────────────────────────────────────
//
// A quarter of every planned row is a GPP block: the GPP sentinel exercise
// with the block in metadata.gpp — a title, a description and rows of
// (exercise, reps text, sets, load text) the athlete ticks off.

/**
 * Pure: one `--row` value → a GPP row. Fields separated by `|`, in the
 * order the block shows them: `exercise | reps | sets | load`. Only the
 * exercise is required; sets defaults to 1. Reps stay text ("60s",
 * "8+8", "AMRAP"), load stays text ("24 kg", "BW").
 */
export function parseGppRowSpec(spec: string): { ok: true; row: GppRow } | { ok: false; reason: string } {
  const parts = spec.split('|').map(s => s.trim());
  const [exercise, reps = '', setsText = '', load = ''] = parts;
  if (!exercise) return { ok: false, reason: `a GPP row needs an exercise name first: "Wall sits | 60s | 3" (got "${spec}")` };
  if (parts.length > 4) return { ok: false, reason: `too many fields in "${spec}" — exercise | reps | sets | load` };
  let sets = 1;
  if (setsText !== '') {
    const n = Number(setsText.replace(/\s*(sets?|sæt|x|×)\s*$/i, ''));
    if (!Number.isInteger(n) || n < 0) return { ok: false, reason: `sets must be a whole number in "${spec}" (got "${setsText}")` };
    sets = n;
  }
  return { ok: true, row: { exercise, reps, sets, load } };
}

/** The coach's GPP sentinel exercise, created the way the planner creates it when missing. */
export async function ensureGppSentinel(client: EmosClient, ownerId: string): Promise<{ id: string; created: boolean }> {
  const { data: existing, error } = await client
    .from('exercises')
    .select('id')
    .eq('exercise_code', 'GPP')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return { id: (existing as { id: string }).id, created: false };
  const def = SENTINEL_DEFS.GPP;
  const { data: created, error: cErr } = await client
    .from('exercises')
    .insert({
      name: def.name,
      category: '— System',
      default_unit: 'other',
      color: def.color,
      exercise_code: 'GPP',
      counts_towards_totals: false,
      is_competition_lift: false,
      owner_id: ownerId,
    })
    .select('id')
    .single();
  if (cErr) throw cErr;
  return { id: (created as { id: string }).id, created: true };
}

export interface AddGppParams {
  weekPlanId: string;
  dayIndex: number;
  /** The coach who owns the sentinel — the athlete's owner. */
  ownerId: string;
  gpp: GppSection;
  position?: number | null;
}

/** Add a GPP block: the planner's `/gpp` — a sentinel row, unit free_text, the block in metadata. */
export async function addGppBlock(client: EmosClient, p: AddGppParams): Promise<AddRowResult & { sentinelCreated: boolean }> {
  const plan = await loadPlanForWrite(client, p.weekPlanId, p.dayIndex);
  const position = await resolvePosition(client, p.weekPlanId, p.dayIndex, p.position);
  const sentinel = await ensureGppSentinel(client, p.ownerId);
  const { data: inserted, error } = await client
    .from('planned_exercises')
    .insert([{
      weekplan_id: p.weekPlanId,
      day_index: p.dayIndex,
      exercise_id: sentinel.id,
      position,
      unit: 'free_text' as const,
      prescription_raw: null,
      summary_total_sets: 0,
      summary_total_reps: 0,
      summary_highest_load: null,
      summary_avg_load: null,
      is_combo: false,
      source: 'individual' as const,
      metadata: { gpp: p.gpp } as PlannedExerciseMetadata,
    }])
    .select('id')
    .single();
  if (error) throw error;
  const dayActivated = await activateDay(client, plan, p.dayIndex);
  return { plannedExerciseId: (inserted as { id: string }).id, position, dayActivated, sentinelCreated: sentinel.created };
}

export interface EditGppParams {
  plannedExerciseId: string;
  title?: string;
  description?: string;
  /** Replaces the block's rows when given. */
  rows?: GppRow[];
}

/** Edit a GPP block in place — the planner's writeGppSection: metadata.gpp replaced, other keys kept. */
export async function editGppBlock(client: EmosClient, p: EditGppParams): Promise<{ plannedExerciseId: string; gpp: GppSection; changed: string[] }> {
  const row = await loadEditableRow(client, p.plannedExerciseId);
  const current = row.metadata?.gpp;
  if (!current) throw new Error('this row is not a GPP block — edit-exercise edits an exercise row');
  const changed: string[] = [];
  const gpp: GppSection = { ...current, rows: [...current.rows] };
  if (p.title !== undefined && p.title !== current.title) { gpp.title = p.title; changed.push('title'); }
  if (p.description !== undefined && p.description !== current.description) { gpp.description = p.description; changed.push('description'); }
  if (p.rows !== undefined) { gpp.rows = p.rows; changed.push(`rows (${p.rows.length})`); }
  if (changed.length === 0) return { plannedExerciseId: row.id, gpp: current, changed };
  const meta = { ...(row.metadata ?? {}), gpp } as PlannedExerciseMetadata;
  const { error } = await client.from('planned_exercises').update({ metadata: meta }).eq('id', row.id);
  if (error) throw error;
  await promoteToIndividual(client, row.id);
  return { plannedExerciseId: row.id, gpp, changed };
}
