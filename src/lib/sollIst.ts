/**
 * sollIst — domain logic for the Soll–Ist analysis (Analysis › Soll–Ist).
 *
 * A Soll–Ist sheet relates assistance exercises to the two reference lifts
 * (snatch / clean & jerk, "Kategorie 1 / 2" in the Trainingsmittelkatalog).
 * Each model row says: at reference = 100, the athlete should manage
 * `index_pct` % of the reference for `reps` repetitions (back squat → C&J →
 * 120 → ×3). From that we derive:
 *
 *   Soll   = index × current reference        (what the model expects today)
 *   Ist    = the athlete's PR at that rep count (real, estimated, or typed)
 *   Δ      = Ist − Soll  (kg and %)            (strength / weakness)
 *   Target = index × goal reference            (numbers to hit for the goal)
 *   To go  = Target − Ist
 *
 * Textbook models ship as code presets (sollIstPresets.ts); individual and
 * custom models live in `sollist_models` / `sollist_model_rows`. Saved sheets
 * live in `sollist_analyses`. All math is pure; Supabase access is confined
 * to the service functions at the bottom (API-first, CLAUDE.md).
 */
import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import { buildPRRows, REP_COUNTS, type RepCount } from './prTable';
import { roundToHalf } from './xrmUtils';
import type { AthletePRHistory, Exercise } from './database.types';

export type RefSlot = 'snatch' | 'clean_and_jerk';

/** One line of a reference model. `exerciseId` is null while a preset row is
 *  still unmapped to the coach's catalogue (the wizard surfaces those). */
export interface SollIstRow {
  exerciseId: string | null;
  /** Display name — the catalogue name once mapped, the preset label before. */
  label: string;
  refSlot: RefSlot;
  /** % of the reference lift at reference = 100 (e.g. back squat 120). */
  indexPct: number;
  reps: number;
}

export type SollIstModelKind = 'textbook' | 'individual' | 'custom';

export interface SollIstModel {
  /** DB uuid, or `preset:<key>` for built-in textbook models. */
  id: string;
  name: string;
  kind: SollIstModelKind;
  athleteId: string | null;
  notes: string | null;
  rows: SollIstRow[];
  updatedAt: string | null;
}

export interface RefValues {
  currentSn: number | null;
  currentCj: number | null;
  goalSn: number | null;
  goalCj: number | null;
}

export type IstSource = 'real' | 'estimated' | 'override';

export interface IstValue {
  valueKg: number;
  source: IstSource;
}

export interface ComputedSollIstRow {
  row: SollIstRow;
  soll: number | null;
  ist: IstValue | null;
  deltaKg: number | null;
  /** Ist as % of Soll (100 = exactly on the model). */
  deltaPct: number | null;
  target: number | null;
  /** Target − Ist; ≤ 0 means the goal-supporting number is already there. */
  toGo: number | null;
}

/** Key for Ist lookups and coach overrides: `<exerciseId>|<reps>`. */
export const istKey = (exerciseId: string, reps: number): string => `${exerciseId}|${reps}`;

const refFor = (slot: RefSlot, current: RefValues): number | null =>
  slot === 'snatch' ? current.currentSn : current.currentCj;

const goalFor = (slot: RefSlot, current: RefValues): number | null =>
  slot === 'snatch' ? current.goalSn : current.goalCj;

/**
 * Pure sheet computation. `ist` maps istKey → IstValue; pass an empty map for
 * the no-athlete "index 100" sheet (Soll/Target still computed, Ist columns
 * stay empty).
 */
export function computeSollIst(
  rows: SollIstRow[],
  refs: RefValues,
  ist: Map<string, IstValue>,
): ComputedSollIstRow[] {
  return rows.map((row) => {
    const ref = refFor(row.refSlot, refs);
    const goal = goalFor(row.refSlot, refs);
    const soll = ref != null ? (ref * row.indexPct) / 100 : null;
    const target = goal != null ? (goal * row.indexPct) / 100 : null;
    const istVal = row.exerciseId ? ist.get(istKey(row.exerciseId, row.reps)) ?? null : null;
    const deltaKg = istVal != null && soll != null ? istVal.valueKg - soll : null;
    const deltaPct = istVal != null && soll != null && soll > 0 ? (istVal.valueKg / soll) * 100 : null;
    const toGo = istVal != null && target != null ? target - istVal.valueKg : null;
    return { row, soll, ist: istVal, deltaKg, deltaPct, target, toGo };
  });
}

/**
 * Build the Ist map for an athlete from PR history: real rep-max where one is
 * logged, otherwise the PR table's estimated (phantom) rep-max, with coach
 * overrides winning over both. Reuses buildPRRows so the sheet never disagrees
 * with the PR panel about what a rep-max is.
 */
export function buildIstMap(
  rows: SollIstRow[],
  exercises: Exercise[],
  history: AthletePRHistory[],
  overrides: Record<string, number>,
): Map<string, IstValue> {
  const map = new Map<string, IstValue>();
  const wanted = new Set(rows.map((r) => r.exerciseId).filter((id): id is string => id != null));
  const relevant = exercises.filter((e) => wanted.has(e.id));
  const prRows = buildPRRows(relevant, history);

  for (const prRow of prRows) {
    for (const cell of prRow.cells) {
      const key = istKey(prRow.exercise.id, cell.repCount);
      if (cell.current) map.set(key, { valueKg: cell.current.value_kg, source: 'real' });
      else if (cell.phantom != null) map.set(key, { valueKg: cell.phantom, source: 'estimated' });
    }
  }
  for (const [key, valueKg] of Object.entries(overrides)) {
    map.set(key, { valueKg, source: 'override' });
  }
  return map;
}

/** Suggested current reference value for a ref exercise: the real 1RM when
 *  logged, otherwise the PR table's implied 1RM. Null when no PRs exist. */
export function suggestReference(
  refExercise: Exercise | null,
  history: AthletePRHistory[],
): { valueKg: number; source: IstSource } | null {
  if (!refExercise) return null;
  const [row] = buildPRRows([refExercise], history);
  const real = row.cells.find((c) => c.repCount === 1)?.current;
  if (real) return { valueKg: real.value_kg, source: 'real' };
  if (row.implied1RM != null) return { valueKg: row.implied1RM, source: 'estimated' };
  return null;
}

/**
 * Capture the athlete's *actual* ratios as an individual model: every row
 * with an Ist value gets index = Ist / current-reference × 100 (one decimal).
 * Rows without an Ist keep the source model's index.
 */
export function captureIndividualRows(
  computed: ComputedSollIstRow[],
  refs: RefValues,
): SollIstRow[] {
  return computed.map(({ row, ist }) => {
    const ref = refFor(row.refSlot, refs);
    if (ist == null || ref == null || ref <= 0) return { ...row };
    return { ...row, indexPct: Math.round((ist.valueKg / ref) * 1000) / 10 };
  });
}

/** Resolve the coach's catalogue exercise acting as a reference lift.
 *  Primary: lift_slot; fallback: name heuristic (same as LiftRatios). */
export function resolveRefExercise(slot: RefSlot, exercises: Exercise[]): Exercise | null {
  const bySlot = exercises.find((e) => e.lift_slot === slot);
  if (bySlot) return bySlot;
  if (slot === 'snatch') {
    return (
      exercises.find((e) => {
        const n = e.name.toLowerCase();
        return n.includes('snatch') && !n.includes('pull') && !n.includes('press') && !n.includes('power') && !n.includes('balance');
      }) ?? null
    );
  }
  return exercises.find((e) => {
    const n = e.name.toLowerCase();
    return n.includes('clean') && n.includes('jerk');
  }) ?? null;
}

/** Round kg values for display/storage the way the PR table does. */
export const roundKg = roundToHalf;

/** Valid rep counts for model rows (mirrors the PR table). */
export const SOLLIST_REP_COUNTS: readonly RepCount[] = REP_COUNTS;

/* ------------------------------------------------------------------ */
/* Persistence — sollist_models / sollist_model_rows                   */
/* ------------------------------------------------------------------ */

interface ModelDbRow {
  id: string;
  owner_id: string;
  name: string;
  kind: 'individual' | 'custom';
  athlete_id: string | null;
  notes: string | null;
  updated_at: string;
  sollist_model_rows: Array<{
    exercise_id: string;
    ref_slot: RefSlot;
    index_pct: number;
    reps: number;
    display_order: number | null;
  }>;
}

export async function fetchSollIstModels(exercises: Exercise[]): Promise<SollIstModel[]> {
  const { data, error } = await supabase
    .from('sollist_models')
    .select('id, owner_id, name, kind, athlete_id, notes, updated_at, sollist_model_rows(exercise_id, ref_slot, index_pct, reps, display_order)')
    .eq('owner_id', getOwnerId())
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const nameOf = new Map(exercises.map((e) => [e.id, e.name]));
  return ((data ?? []) as unknown as ModelDbRow[]).map((m) => ({
    id: m.id,
    name: m.name,
    kind: m.kind,
    athleteId: m.athlete_id,
    notes: m.notes,
    updatedAt: m.updated_at,
    rows: m.sollist_model_rows
      .slice()
      .sort((a, b) => (a.display_order ?? 1e9) - (b.display_order ?? 1e9))
      .map((r) => ({
        exerciseId: r.exercise_id,
        label: nameOf.get(r.exercise_id) ?? 'Unknown exercise',
        refSlot: r.ref_slot,
        indexPct: Number(r.index_pct),
        reps: r.reps,
      })),
  }));
}

/** Insert or update a model; rows are replaced wholesale (last-write-wins). */
export async function saveSollIstModel(model: {
  id?: string | null;
  name: string;
  kind: 'individual' | 'custom';
  athleteId: string | null;
  notes?: string | null;
  rows: SollIstRow[];
}): Promise<string> {
  const persistable = model.rows.filter((r) => r.exerciseId != null);
  let modelId = model.id ?? null;
  if (modelId) {
    const { error } = await supabase
      .from('sollist_models')
      .update({
        name: model.name,
        kind: model.kind,
        athlete_id: model.athleteId,
        notes: model.notes ?? null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', modelId);
    if (error) throw error;
    const { error: delError } = await supabase.from('sollist_model_rows').delete().eq('model_id', modelId);
    if (delError) throw delError;
  } else {
    const { data, error } = await supabase
      .from('sollist_models')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      .insert({
        owner_id: getOwnerId(),
        name: model.name,
        kind: model.kind,
        athlete_id: model.athleteId,
        notes: model.notes ?? null,
      } as any)
      .select('id')
      .single();
    if (error) throw error;
    modelId = (data as { id: string }).id;
  }
  if (persistable.length > 0) {
    const { error } = await supabase.from('sollist_model_rows').insert(
      persistable.map((r, i) => ({
        model_id: modelId,
        exercise_id: r.exerciseId,
        ref_slot: r.refSlot,
        index_pct: r.indexPct,
        reps: r.reps,
        display_order: i,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
      })) as any,
    );
    if (error) throw error;
  }
  return modelId as string;
}

export async function deleteSollIstModel(id: string): Promise<void> {
  const { error } = await supabase.from('sollist_models').delete().eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Persistence — sollist_analyses                                      */
/* ------------------------------------------------------------------ */

export interface SollIstAnalysisRecord {
  id: string;
  name: string;
  athleteId: string | null;
  /** DB model id, mutually exclusive with presetKey. */
  modelId: string | null;
  presetKey: string | null;
  refSnExerciseId: string | null;
  refCjExerciseId: string | null;
  currentSn: number | null;
  currentCj: number | null;
  goalSn: number | null;
  goalCj: number | null;
  istOverrides: Record<string, number>;
  /** UI state incl. the working rows snapshot so a reload is faithful even
   *  after the source model/preset changed. */
  options: {
    heatmap?: boolean;
    diff?: boolean;
    sideModelRef?: string | null;
    rows?: SollIstRow[];
  };
  updatedAt: string | null;
}

interface AnalysisDbRow {
  id: string;
  name: string;
  athlete_id: string | null;
  model_id: string | null;
  preset_key: string | null;
  ref_sn_exercise_id: string | null;
  ref_cj_exercise_id: string | null;
  current_sn: number | null;
  current_cj: number | null;
  goal_sn: number | null;
  goal_cj: number | null;
  ist_overrides: Record<string, number>;
  options: SollIstAnalysisRecord['options'];
  updated_at: string;
}

export async function fetchSollIstAnalyses(): Promise<SollIstAnalysisRecord[]> {
  const { data, error } = await supabase
    .from('sollist_analyses')
    .select('*')
    .eq('owner_id', getOwnerId())
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as AnalysisDbRow[]).map((a) => ({
    id: a.id,
    name: a.name,
    athleteId: a.athlete_id,
    modelId: a.model_id,
    presetKey: a.preset_key,
    refSnExerciseId: a.ref_sn_exercise_id,
    refCjExerciseId: a.ref_cj_exercise_id,
    currentSn: a.current_sn != null ? Number(a.current_sn) : null,
    currentCj: a.current_cj != null ? Number(a.current_cj) : null,
    goalSn: a.goal_sn != null ? Number(a.goal_sn) : null,
    goalCj: a.goal_cj != null ? Number(a.goal_cj) : null,
    istOverrides: a.ist_overrides ?? {},
    options: a.options ?? {},
    updatedAt: a.updated_at,
  }));
}

export async function saveSollIstAnalysis(
  rec: Omit<SollIstAnalysisRecord, 'id' | 'updatedAt'> & { id?: string | null },
): Promise<string> {
  const payload = {
    owner_id: getOwnerId(),
    name: rec.name,
    athlete_id: rec.athleteId,
    model_id: rec.modelId,
    preset_key: rec.presetKey,
    ref_sn_exercise_id: rec.refSnExerciseId,
    ref_cj_exercise_id: rec.refCjExerciseId,
    current_sn: rec.currentSn,
    current_cj: rec.currentCj,
    goal_sn: rec.goalSn,
    goal_cj: rec.goalCj,
    ist_overrides: rec.istOverrides,
    options: rec.options,
    updated_at: new Date().toISOString(),
  };
  if (rec.id) {
    const { error } = await supabase.from('sollist_analyses').update(payload as never).eq('id', rec.id);
    if (error) throw error;
    return rec.id;
  }
  const { data, error } = await supabase
    .from('sollist_analyses')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
    .insert(payload as any)
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function deleteSollIstAnalysis(id: string): Promise<void> {
  const { error } = await supabase.from('sollist_analyses').delete().eq('id', id);
  if (error) throw error;
}
