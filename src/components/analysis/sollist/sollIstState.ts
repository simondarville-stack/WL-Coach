// Sheet state + shared helpers for the Soll–Ist surface. Pure functions only;
// all Supabase access lives in src/lib/sollIst.ts.

import type { Exercise } from '../../../lib/database.types';
import type { RefValuesMap, SavedRef, SollIstAnalysisRecord, SollIstModel, SollIstRef, SollIstRow } from '../../../lib/sollIst';
import { roundKg } from '../../../lib/sollIst';
import { SOLLIST_PRESETS, isPresetId, presetId, presetKeyFromId, resolvePreset } from '../../../lib/sollIstPresets';

/** A reference as held by the sheet: identity + the coach's numbers. */
export interface SheetRef extends SollIstRef {
  current: number | null;
  goal: number | null;
}

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
  /** Second model shown side-by-side, or null for single-model view. */
  sideModelRef: string | null;
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
    sideModelRef: null,
  };
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
    options: { heatmap: sheet.heatmap, diff: sheet.diff, sideModelRef: sheet.sideModelRef, rows: sheet.rows },
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
    sideModelRef: rec.options.sideModelRef ?? null,
  };
}

/* ---------- reference pill styling (generic palette by position) ---------- */

/** Short tag for a reference pill: initials for multi-word labels
 *  ("Clean & Jerk" → CJ, "Back squat" → BS), first two letters otherwise. */
export function refAbbrev(label: string): string {
  const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join('').slice(0, 3).toUpperCase();
  return label.slice(0, 2).toUpperCase();
}

/** Data-driven pill colours, cycled by reference position in the sheet. */
const PILL_PALETTE: Array<{ bg: string; fg: string }> = [
  { bg: 'rgba(24, 95, 165, 0.12)', fg: '#185FA5' },
  { bg: 'rgba(141, 59, 110, 0.12)', fg: '#8d3b6e' },
  { bg: 'rgba(28, 124, 60, 0.12)', fg: '#1c7c3c' },
  { bg: 'rgba(148, 98, 0, 0.14)', fg: '#946200' },
  { bg: 'rgba(91, 78, 163, 0.12)', fg: '#5b4ea3' },
  { bg: 'rgba(163, 69, 47, 0.12)', fg: '#a3452f' },
];

export function refPillStyle(index: number): { bg: string; fg: string } {
  return PILL_PALETTE[((index % PILL_PALETTE.length) + PILL_PALETTE.length) % PILL_PALETTE.length];
}

/* ---------- formatting (European convention, CLAUDE.md) ---------- */

/** kg for table cells: rounded to 0,5 kg, comma decimal. */
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
