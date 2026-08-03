/**
 * sollIst — domain logic for the Soll–Ist analysis (Analysis › Soll–Ist).
 *
 * A Soll–Ist sheet relates exercises to one or more *references*. Classic
 * use is the Trainingsmittelkatalog pairing (snatch = Kategorie 1, clean &
 * jerk = Kategorie 2), but references are fully generic: any catalogue
 * exercise can act as one (back squat as the index for a squat-family
 * sheet), and a reference can also be a plain typed number with no
 * catalogue binding at all. Each model row says: at reference = 100, the
 * athlete should manage `indexPct` % of that reference for `reps`
 * repetitions. From that we derive:
 *
 *   Soll   = index × current reference        (what the model expects today)
 *   Ist    = the athlete's PR at that rep count (real, estimated, or typed)
 *   Δ      = Ist − Soll  (kg and %)            (strength / weakness)
 *   Target = index × goal reference            (numbers to hit for the goal)
 *   To go  = Target − Ist
 *
 * Textbook models ship as code presets (sollIstPresets.ts); individual and
 * custom models live in `sollist_models` / `sollist_model_rows` (+ a `refs`
 * jsonb). Saved sheets live in `sollist_analyses`. All math is pure;
 * Supabase access is confined to the service functions at the bottom
 * (API-first, CLAUDE.md).
 */
import { supabase } from './supabase';
import { getOwnerId } from './ownerContext';
import { buildPRRows, REP_COUNTS, type RepCount } from './prTable';
import { roundToHalf } from './xrmUtils';
import type { AthletePRHistory, Exercise } from './database.types';

/** One reference of a model/sheet. `exerciseId` binds it to the catalogue
 *  (enables PR suggestions); null means the coach types the numbers. */
export interface SollIstRef {
  /** Stable identity within the model/sheet (rows point at this). */
  key: string;
  label: string;
  exerciseId: string | null;
}

/** One line of a reference model. `exerciseId` is null while a preset/CSV row
 *  is still unmapped to the coach's catalogue (the wizard surfaces those). */
export interface SollIstRow {
  exerciseId: string | null;
  /** Display name — the catalogue name once mapped, the source label before. */
  label: string;
  /** Which reference the index is relative to (SollIstRef.key). */
  refKey: string;
  /** % of the reference at reference = 100 (e.g. back squat 120). */
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
  refs: SollIstRef[];
  rows: SollIstRow[];
  updatedAt: string | null;
}

/** Current + goal value of one reference, keyed by SollIstRef.key. */
export interface RefValue {
  current: number | null;
  goal: number | null;
}
export type RefValuesMap = Record<string, RefValue>;

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

/**
 * Pure sheet computation. `refValues` maps ref key → current/goal; `ist`
 * maps istKey → IstValue (pass an empty map for the no-athlete "index 100"
 * sheet — Soll/Target still compute, Ist columns stay empty).
 */
export function computeSollIst(
  rows: SollIstRow[],
  refValues: RefValuesMap,
  ist: Map<string, IstValue>,
): ComputedSollIstRow[] {
  return rows.map((row) => {
    const ref = refValues[row.refKey]?.current ?? null;
    const goal = refValues[row.refKey]?.goal ?? null;
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

/** Suggested current value for a reference bound to an exercise: the real 1RM
 *  when logged, otherwise the PR table's implied 1RM. Null when no PRs exist
 *  (or the reference is manual, i.e. unbound). */
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
  refValues: RefValuesMap,
): SollIstRow[] {
  return computed.map(({ row, ist }) => {
    const ref = refValues[row.refKey]?.current ?? null;
    if (ist == null || ref == null || ref <= 0) return { ...row };
    return { ...row, indexPct: Math.round((ist.valueKg / ref) * 1000) / 10 };
  });
}

/** Round kg values for display/storage the way the PR table does. */
export const roundKg = roundToHalf;

/** Valid rep counts for model rows (mirrors the PR table). */
export const SOLLIST_REP_COUNTS: readonly RepCount[] = REP_COUNTS;

/** Stable-enough key for a new reference (sheet-local uniqueness suffices). */
export function newRefKey(label: string, taken: Iterable<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'ref';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  let i = 2;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

/* ------------------------------------------------------------------ */
/* Persistence — sollist_models / sollist_model_rows                   */
/* ------------------------------------------------------------------ */

interface RefsJson {
  key: string;
  label: string;
  exercise_id: string | null;
}

const refsFromJson = (json: unknown): SollIstRef[] =>
  Array.isArray(json)
    ? (json as RefsJson[]).map((r) => ({ key: r.key, label: r.label, exerciseId: r.exercise_id ?? null }))
    : [];

const refsToJson = (refs: SollIstRef[]): RefsJson[] =>
  refs.map((r) => ({ key: r.key, label: r.label, exercise_id: r.exerciseId }));

interface ModelDbRow {
  id: string;
  owner_id: string;
  name: string;
  kind: 'individual' | 'custom';
  athlete_id: string | null;
  notes: string | null;
  refs: unknown;
  updated_at: string;
  sollist_model_rows: Array<{
    exercise_id: string;
    ref_key: string;
    index_pct: number;
    reps: number;
    display_order: number | null;
    label: string | null;
  }>;
}

export async function fetchSollIstModels(exercises: Exercise[]): Promise<SollIstModel[]> {
  const { data, error } = await supabase
    .from('sollist_models')
    .select('id, owner_id, name, kind, athlete_id, notes, refs, updated_at, sollist_model_rows(exercise_id, ref_key, index_pct, reps, display_order, label)')
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
    refs: refsFromJson(m.refs),
    updatedAt: m.updated_at,
    rows: m.sollist_model_rows
      .slice()
      .sort((a, b) => (a.display_order ?? 1e9) - (b.display_order ?? 1e9))
      .map((r) => ({
        exerciseId: r.exercise_id,
        // A mapped row reads its label from the catalogue, so renaming an
        // exercise keeps the model in sync. An unmapped row keeps the source
        // label it came in with (a preset's movement name, or a CSV cell) so
        // the coach can still tell what it was meant to be.
        label: (r.exercise_id ? nameOf.get(r.exercise_id) : null) ?? r.label ?? 'Unknown exercise',
        refKey: r.ref_key,
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
  refs: SollIstRef[];
  rows: SollIstRow[];
}): Promise<string> {
  // Every row is persisted, including ones that have not been mapped to a
  // catalogue exercise yet. This used to filter them out — because
  // sollist_model_rows.exercise_id was NOT NULL — which silently DROPPED rows
  // from a forked preset (see migration 20260803230000). An unmapped row now
  // carries its source label instead, so the fork is lossless.
  let modelId = model.id ?? null;
  if (modelId) {
    const { error } = await supabase
      .from('sollist_models')
      .update({
        name: model.name,
        kind: model.kind,
        athlete_id: model.athleteId,
        notes: model.notes ?? null,
        refs: refsToJson(model.refs),
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', modelId);
    if (error) throw error;
    const { error: delError } = await supabase.from('sollist_model_rows').delete().eq('model_id', modelId);
    if (delError) throw delError;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
    const insertRow: any = {
      owner_id: getOwnerId(),
      name: model.name,
      kind: model.kind,
      athlete_id: model.athleteId,
      notes: model.notes ?? null,
      refs: refsToJson(model.refs),
    };
    const { data, error } = await supabase
      .from('sollist_models')
      .insert(insertRow)
      .select('id')
      .single();
    if (error) throw error;
    modelId = (data as { id: string }).id;
  }
  if (model.rows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
    const rowsToInsert: any = model.rows.map((r, i) => ({
      model_id: modelId,
      exercise_id: r.exerciseId,
      ref_key: r.refKey,
      index_pct: r.indexPct,
      reps: r.reps,
      display_order: i,
      // Only stored for an unmapped row; a mapped one takes its label from the
      // catalogue on read, so renaming an exercise keeps the model in sync.
      label: r.exerciseId ? null : r.label,
    }));
    const { error } = await supabase.from('sollist_model_rows').insert(rowsToInsert);
    if (error) throw error;
  }
  return modelId as string;
}

/**
 * Rename / re-note / re-assign a model WITHOUT touching its rows.
 *
 * Deliberately not `saveSollIstModel`: that one deletes every
 * `sollist_model_rows` row and re-inserts them, which is right for a full save
 * and catastrophic for a rename.
 */
export async function updateSollIstModelMeta(
  id: string,
  patch: { name?: string; notes?: string | null; athleteId?: string | null },
): Promise<void> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.athleteId !== undefined) update.athlete_id = patch.athleteId;
  const { error } = await supabase.from('sollist_models').update(update as never).eq('id', id);
  if (error) throw error;
}

/** Save a copy of a model under a new name. Returns the new model's id. */
export async function duplicateSollIstModel(model: SollIstModel): Promise<string> {
  return saveSollIstModel({
    id: null,
    name: `${model.name} (copy)`,
    kind: model.kind === 'individual' ? 'individual' : 'custom',
    athleteId: model.athleteId,
    notes: model.notes,
    refs: model.refs,
    rows: model.rows,
  });
}

/**
 * Delete a model and its rows.
 *
 * Safe by schema (verified against the live DB): `sollist_model_rows` cascades,
 * and `sollist_analyses.model_id` is ON DELETE SET NULL — a saved analysis that
 * pointed here survives and falls back to the row snapshot it stored in its own
 * options, so deleting a model never destroys past analysis.
 */
export async function deleteSollIstModel(id: string): Promise<void> {
  const { error } = await supabase.from('sollist_models').delete().eq('id', id);
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Persistence — sollist_analyses                                      */
/* ------------------------------------------------------------------ */

/** A reference as stored on a saved analysis: identity + values. */
export interface SavedRef extends SollIstRef {
  current: number | null;
  goal: number | null;
}

export interface SollIstAnalysisRecord {
  id: string;
  name: string;
  athleteId: string | null;
  /** DB model id, mutually exclusive with presetKey. */
  modelId: string | null;
  presetKey: string | null;
  refs: SavedRef[];
  istOverrides: Record<string, number>;
  /** UI state incl. the working rows snapshot so a reload is faithful even
   *  after the source model/preset changed. */
  options: {
    heatmap?: boolean;
    diff?: boolean;
    sideModelRef?: string | null;
    rows?: SollIstRow[];
    /** Data-view state (group/filter/sort) — shape owned by the UI layer
     *  (SheetView in sollIstState.ts); opaque here. */
    view?: unknown;
  };
  updatedAt: string | null;
}

interface SavedRefJson extends RefsJson {
  current: number | null;
  goal: number | null;
}

interface AnalysisDbRow {
  id: string;
  name: string;
  athlete_id: string | null;
  model_id: string | null;
  preset_key: string | null;
  refs: unknown;
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
    refs: Array.isArray(a.refs)
      ? (a.refs as SavedRefJson[]).map((r) => ({
          key: r.key,
          label: r.label,
          exerciseId: r.exercise_id ?? null,
          current: r.current != null ? Number(r.current) : null,
          goal: r.goal != null ? Number(r.goal) : null,
        }))
      : [],
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
    refs: rec.refs.map((r) => ({ key: r.key, label: r.label, exercise_id: r.exerciseId, current: r.current, goal: r.goal })),
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
