// Sheet state + shared helpers for the Ratio Analysis surface. Pure functions only;
// all Supabase access lives in src/lib/sollIst.ts.

import type { Exercise } from '../../../lib/database.types';
import type { ComputedSollIstRow, RefValuesMap, SavedRef, SollIstAnalysisRecord, SollIstModel, SollIstRef, SollIstRow } from '../../../lib/sollIst';
import { roundKg } from '../../../lib/sollIst';
import { SOLLIST_PRESETS, isPresetId, presetId, presetKeyFromId, resolvePreset } from '../../../lib/sollIstPresets';

/** A reference as held by the sheet: identity + the coach's numbers. */
export interface SheetRef extends SollIstRef {
  current: number | null;
  goal: number | null;
}

/* ---------- data-view state (group / filter / sort) ---------- */

export type GroupBy = 'none' | 'ref' | 'category';

export type SortKey =
  | 'exercise' | 'index' | 'reps' | 'soll' | 'ist'
  | 'deltaKg' | 'deltaPct'
  | 'target' | 'goalDeltaKg' | 'goalDeltaPct'
  /** Retired header, kept as a key: a sort saved before the goal block gained
   *  its own Δ pair still lives in `sollist_analyses.options.view` and in the
   *  device draft, and neither is validated on read. */
  | 'toGo';

export interface SheetView {
  groupBy: GroupBy;
  /** Show only rows pointing at this reference key (null = all). */
  refFilter: string | null;
  /** Show only rows whose exercise has this category name (null = all). */
  categoryFilter: string | null;
  search: string;
  sort: { key: SortKey; dir: 1 | -1 } | null;
}

export const defaultView = (): SheetView => ({ groupBy: 'none', refFilter: null, categoryFilter: null, search: '', sort: null });

export interface SheetState {
  analysisId: string | null;
  name: string;
  athleteId: string | null;
  /** `preset:<key>` or a sollist_models uuid. */
  modelRef: string | null;
  /** Working references — editable, any exercise (or none) can anchor. */
  refs: SheetRef[];
  /** Working rows — a resolved, editable copy of the model/preset. */
  rows: SollIstRow[];
  /** Coach-typed Ist values, istKey → kg. */
  overrides: Record<string, number>;
  heatmap: boolean;
  diff: boolean;
  /** Build Actual from measured xRM only, ignoring the PR table's estimates. */
  onlyMeasured: boolean;
  /**
   * Which athlete the bound references were filled from, or null when they
   * have never been filled.
   *
   * Without this, a reference's `current` outlives an athlete change: the
   * autofill only fills NULLS, and `onAthleteChange` is not the only way the
   * athlete gets set — the Analysis scope seeds it at mount, and the restored
   * draft carries one. The result is one athlete's PR sitting under another
   * athlete's name, which is worse than showing nothing.
   */
  refsFilledFor: string | null;
  /** Second model shown side-by-side, or null for single-model view. */
  sideModelRef: string | null;
  view: SheetView;
}

export function emptySheet(): SheetState {
  return {
    analysisId: null,
    name: '',
    athleteId: null,
    modelRef: null,
    refs: [],
    rows: [],
    overrides: {},
    heatmap: true,
    diff: true,
    onlyMeasured: false,
    refsFilledFor: null,
    sideModelRef: null,
    view: defaultView(),
  };
}

/**
 * Is this a usable sheet? Guards the device-local draft, which is JSON from
 * localStorage and therefore untrusted — a draft written by an older build, or
 * hand-edited, must be discarded rather than crash the surface on mount.
 * Deliberately shallow: it checks the shape the render path depends on, and
 * fills the rest from `emptySheet` at the call site.
 */
export function isSheetState(value: unknown): value is SheetState {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<SheetState>;
  return Array.isArray(s.refs)
    && Array.isArray(s.rows)
    && typeof s.overrides === 'object' && s.overrides !== null
    && (s.athleteId === null || typeof s.athleteId === 'string')
    && (s.modelRef === null || typeof s.modelRef === 'string');
}

export interface ModelOption {
  ref: string;
  name: string;
  kind: 'textbook' | 'individual' | 'custom';
  athleteId: string | null;
}

export function modelOptions(models: SollIstModel[]): ModelOption[] {
  return [
    ...SOLLIST_PRESETS.map((p) => ({ ref: presetId(p.key), name: p.name, kind: 'textbook' as const, athleteId: null })),
    ...models.map((m) => ({ ref: m.id, name: m.name, kind: m.kind === 'textbook' ? ('custom' as const) : m.kind, athleteId: m.athleteId })),
  ];
}

/** Resolve a model reference (preset or stored) to name + refs + rows. */
export function resolveModelRef(
  ref: string | null,
  models: SollIstModel[],
  exercises: Exercise[],
): { name: string; refs: SollIstRef[]; rows: SollIstRow[] } | null {
  if (!ref) return null;
  if (isPresetId(ref)) {
    const key = presetKeyFromId(ref);
    const preset = SOLLIST_PRESETS.find((p) => p.key === key);
    if (!preset) return null;
    const resolved = resolvePreset(preset, exercises);
    return { name: preset.name, refs: resolved.refs, rows: resolved.rows };
  }
  const model = models.find((m) => m.id === ref);
  return model ? { name: model.name, refs: model.refs.map((r) => ({ ...r })), rows: model.rows.map((r) => ({ ...r })) } : null;
}

/** Turn plain refs into sheet refs, carrying over current/goal values from
 *  the previous sheet where the key (or bound exercise) matches — switching
 *  models shouldn't wipe the numbers the coach already typed. */
export function toSheetRefs(refs: SollIstRef[], previous: SheetRef[]): SheetRef[] {
  return refs.map((r) => {
    const prev =
      previous.find((p) => p.key === r.key) ??
      (r.exerciseId != null ? previous.find((p) => p.exerciseId === r.exerciseId) : undefined);
    return { ...r, current: prev?.current ?? null, goal: prev?.goal ?? null };
  });
}

export function refValuesMap(refs: SheetRef[]): RefValuesMap {
  return Object.fromEntries(refs.map((r) => [r.key, { current: r.current, goal: r.goal }]));
}

/** Serialize the sheet for sollist_analyses. */
export function sheetToRecord(sheet: SheetState): Omit<SollIstAnalysisRecord, 'id' | 'updatedAt'> & { id?: string | null } {
  const isPreset = sheet.modelRef != null && isPresetId(sheet.modelRef);
  const refs: SavedRef[] = sheet.refs.map((r) => ({ key: r.key, label: r.label, exerciseId: r.exerciseId, current: r.current, goal: r.goal }));
  return {
    id: sheet.analysisId,
    name: sheet.name,
    athleteId: sheet.athleteId,
    modelId: isPreset ? null : sheet.modelRef,
    presetKey: isPreset ? presetKeyFromId(sheet.modelRef!) : null,
    refs,
    istOverrides: sheet.overrides,
    options: { heatmap: sheet.heatmap, diff: sheet.diff, onlyMeasured: sheet.onlyMeasured, sideModelRef: sheet.sideModelRef, rows: sheet.rows, view: sheet.view },
  };
}

/** Rebuild the sheet from a saved record. The stored rows snapshot wins over
 *  re-resolving the model so a reload is faithful; fall back to resolution
 *  for records saved without one. */
export function sheetFromRecord(
  rec: SollIstAnalysisRecord,
  models: SollIstModel[],
  exercises: Exercise[],
): SheetState {
  const modelRef = rec.presetKey ? presetId(rec.presetKey) : rec.modelId;
  const resolved = resolveModelRef(modelRef, models, exercises);
  const rows = rec.options.rows ?? resolved?.rows ?? [];
  const refs: SheetRef[] =
    rec.refs.length > 0
      ? rec.refs.map((r) => ({ ...r }))
      : (resolved?.refs ?? []).map((r) => ({ ...r, current: null, goal: null }));
  return {
    analysisId: rec.id,
    name: rec.name,
    athleteId: rec.athleteId,
    modelRef,
    refs,
    rows,
    overrides: rec.istOverrides,
    heatmap: rec.options.heatmap ?? true,
    diff: rec.options.diff ?? true,
    onlyMeasured: rec.options.onlyMeasured ?? false,
    // A saved analysis stores the reference values it was saved with, so they
    // belong to its own athlete by construction — mark them filled to stop the
    // autofill treating them as another athlete's leftovers.
    refsFilledFor: rec.athleteId,
    sideModelRef: rec.options.sideModelRef ?? null,
    view: { ...defaultView(), ...((rec.options.view as Partial<SheetView> | undefined) ?? {}) },
  };
}

/* ---------- data-view derivation (filter → sort → group) ---------- */

export interface RowGroup {
  key: string;
  /** Header text; null for the single ungrouped section. */
  label: string | null;
  rows: ComputedSollIstRow[];
}

function sortValue(c: ComputedSollIstRow, key: SortKey): string | number | null {
  switch (key) {
    case 'exercise':
      return c.row.label.toLowerCase();
    case 'index':
      return c.row.indexPct;
    case 'reps':
      return c.row.reps;
    case 'soll':
      return c.soll;
    case 'ist':
      return c.ist?.valueKg ?? null;
    case 'deltaKg':
      return c.deltaKg;
    case 'deltaPct':
      return c.deltaPct;
    case 'target':
      return c.target;
    case 'goalDeltaKg':
      return c.goalDeltaKg;
    case 'goalDeltaPct':
      return c.goalDeltaPct;
    case 'toGo':
      return c.toGo;
  }
}

/**
 * Apply the view to computed rows: filter (search / reference / category),
 * sort (nulls always last), then group ('ref' by sheet-reference order,
 * 'category' by the catalogue's category order, alphabetical fallback).
 */
export function buildRowGroups(
  computed: ComputedSollIstRow[],
  view: SheetView,
  refs: SheetRef[],
  categoryOf: (exerciseId: string | null) => string | null,
  categoryOrder: string[],
  /** Exercise code lookup, so the search box matches codes too. Defaulted so
   *  existing callers (and tests) keep the old name-only behaviour. */
  codeOf: (exerciseId: string | null) => string | null = () => null,
): RowGroup[] {
  const q = view.search.trim().toLowerCase();
  let rows = computed.filter((c) => {
    // Match the code as well as the name: the add-exercise field already
    // ranks on code, so searching "bsq" and getting nothing was inconsistent.
    if (q
      && !c.row.label.toLowerCase().includes(q)
      && !(codeOf(c.row.exerciseId) ?? '').toLowerCase().includes(q)) return false;
    if (view.refFilter && c.row.refKey !== view.refFilter) return false;
    if (view.categoryFilter && (categoryOf(c.row.exerciseId) ?? '—') !== view.categoryFilter) return false;
    return true;
  });

  if (view.sort) {
    const { key, dir } = view.sort;
    rows = rows
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const va = sortValue(a.c, key);
        const vb = sortValue(b.c, key);
        if (va == null && vb == null) return a.i - b.i;
        if (va == null) return 1; // nulls last regardless of direction
        if (vb == null) return -1;
        const cmp = typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : (va as number) - (vb as number);
        return cmp !== 0 ? cmp * dir : a.i - b.i;
      })
      .map((x) => x.c);
  }

  if (view.groupBy === 'ref') {
    const groups = refs
      .map((r) => ({ key: r.key, label: r.label, rows: rows.filter((c) => c.row.refKey === r.key) }))
      .filter((g) => g.rows.length > 0);
    const orphans = rows.filter((c) => !refs.some((r) => r.key === c.row.refKey));
    if (orphans.length > 0) groups.push({ key: '·orphan', label: 'Unknown reference', rows: orphans });
    return groups;
  }

  if (view.groupBy === 'category') {
    const byCat = new Map<string, ComputedSollIstRow[]>();
    for (const c of rows) {
      const cat = categoryOf(c.row.exerciseId) ?? '—';
      const list = byCat.get(cat) ?? [];
      list.push(c);
      byCat.set(cat, list);
    }
    const names = [...byCat.keys()].sort((a, b) => {
      // Catalogue order first, then unknown categories alphabetically,
      // "No category" ('—') always last.
      if (a === '—') return 1;
      if (b === '—') return -1;
      const ia = categoryOrder.indexOf(a);
      const ib = categoryOrder.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib);
      return a.localeCompare(b);
    });
    return names.map((n) => ({ key: n, label: n === '—' ? 'No category' : n, rows: byCat.get(n)! }));
  }

  return [{ key: 'all', label: null, rows }];
}

/* ---------- formatting (European convention, CLAUDE.md) ---------- */

/** kg for table cells: rounded to 0,5 kg, comma decimal. */
/**
 * How an exercise reads in a Ratio Analysis `<select>`: "SN - Snatch" when it has a
 * code, the bare name when it does not. A `<select>` cannot hold styled markup,
 * so the code goes into the option's plain text.
 */
export const exerciseOptionLabel = (
  ex: { name: string; exercise_code: string | null },
): string => (ex.exercise_code ? `${ex.exercise_code} \u00b7 ${ex.name}` : ex.name);

export function fmtKg(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '–';
  return roundKg(v).toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

/** Parse a coach-typed kg value; accepts comma decimals and a ≈ prefix. */
export function parseKgInput(raw: string): number | null {
  const v = parseFloat(raw.replace('≈', '').trim().replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Heat colour for a Δ% cell: ≥100 % green, fading to red at 85 %. */
export function heatColor(deltaPct: number): string {
  if (deltaPct >= 100) return 'rgba(28, 124, 60, 0.16)';
  const t = Math.max(0, Math.min(1, (deltaPct - 85) / 15));
  const r = 200 - 60 * t;
  const g = 60 + 120 * t;
  return `rgba(${Math.round(r)}, ${Math.round(g)}, 60, ${(0.22 - 0.1 * t).toFixed(3)})`;
}
