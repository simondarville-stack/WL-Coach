// Create a week and add / remove single planned rows — the verbs behind
// "start on Asger's next week" and "back squat: 87.5×5, 100×5, 115×5-10".
//
// Mirrors the planner's own paths: `ensureIndividualWeek` is
// `fetchOrCreateWeekPlan` + `fetchPreviousWeekRhythm` (a new week inherits
// the day structure of the athlete's most recent week), `addPlannedExercise`
// is `addExerciseToDay` + the shared prescription write, so summary and
// set-line caches are built exactly as a planner edit would build them.
//
// Takes the Supabase client as an argument; no React, no stores. Used by
// scripts/emos-cli.ts.

import type { DefaultUnit, WeekPlan } from './database.types';
import { detectIntendedUnit } from './prescriptionParser';
import { writePrescriptionRecord, type EmosClient } from './prescriptionWriteService';

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

export async function addPlannedExercise(client: EmosClient, p: AddRowParams): Promise<AddRowResult> {
  const { data: planRaw, error: planErr } = await client
    .from('week_plans')
    .select('id, active_days, is_group_plan, group_id')
    .eq('id', p.weekPlanId)
    .single();
  if (planErr) throw planErr;
  const plan = planRaw as unknown as Pick<WeekPlan, 'id' | 'active_days' | 'is_group_plan' | 'group_id'>;
  if (plan.is_group_plan || plan.group_id) {
    throw new Error('this is a GROUP plan — add the row in the planner and sync, so the athletes receive it');
  }
  if (!Number.isInteger(p.dayIndex) || p.dayIndex < 1) {
    throw new Error(`day slot must be a positive integer (D1 = 1), got ${p.dayIndex}`);
  }

  let position = p.position ?? null;
  if (position == null) {
    const { data } = await client
      .from('planned_exercises')
      .select('position')
      .eq('weekplan_id', p.weekPlanId)
      .eq('day_index', p.dayIndex)
      .order('position', { ascending: false })
      .limit(1);
    position = (((data as { position: number }[] | null)?.[0]?.position) ?? 0) + 1;
  }

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

  // A row on an inactive slot would be an orphan the grid never shows. Done
  // after the insert so a refused row leaves the week untouched.
  let dayActivated = false;
  const active = plan.active_days ?? [];
  if (!active.includes(p.dayIndex)) {
    const { error } = await client
      .from('week_plans')
      .update({ active_days: [...active, p.dayIndex].sort((a, b) => a - b) })
      .eq('id', plan.id);
    if (error) throw error;
    dayActivated = true;
  }
  return { plannedExerciseId: id, position, dayActivated };
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
