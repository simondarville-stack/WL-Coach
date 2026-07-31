// Sheet state + shared helpers for the Soll–Ist surface. Pure functions only;
// all Supabase access lives in src/lib/sollIst.ts.

import type { Exercise } from '../../../lib/database.types';
import type { SollIstAnalysisRecord, SollIstModel, SollIstRow } from '../../../lib/sollIst';
import { roundKg } from '../../../lib/sollIst';
import { SOLLIST_PRESETS, isPresetId, presetId, presetKeyFromId, resolvePreset } from '../../../lib/sollIstPresets';

export interface SheetState {
  analysisId: string | null;
  name: string;
  athleteId: string | null;
  /** `preset:<key>` or a sollist_models uuid. */
  modelRef: string | null;
  /** Working rows — a resolved, editable copy of the model/preset. */
  rows: SollIstRow[];
  refSnExerciseId: string | null;
  refCjExerciseId: string | null;
  currentSn: number | null;
  currentCj: number | null;
  goalSn: number | null;
  goalCj: number | null;
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
    rows: [],
    refSnExerciseId: null,
    refCjExerciseId: null,
    currentSn: 100,
    currentCj: 100,
    goalSn: 105,
    goalCj: 105,
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

/** Resolve a model reference (preset or stored) to display name + rows. */
export function resolveModelRef(
  ref: string | null,
  models: SollIstModel[],
  exercises: Exercise[],
): { name: string; rows: SollIstRow[] } | null {
  if (!ref) return null;
  if (isPresetId(ref)) {
    const key = presetKeyFromId(ref);
    const preset = SOLLIST_PRESETS.find((p) => p.key === key);
    return preset ? { name: preset.name, rows: resolvePreset(preset, exercises) } : null;
  }
  const model = models.find((m) => m.id === ref);
  return model ? { name: model.name, rows: model.rows.map((r) => ({ ...r })) } : null;
}

/** Serialize the sheet for sollist_analyses. */
export function sheetToRecord(sheet: SheetState): Omit<SollIstAnalysisRecord, 'id' | 'updatedAt'> & { id?: string | null } {
  const isPreset = sheet.modelRef != null && isPresetId(sheet.modelRef);
  return {
    id: sheet.analysisId,
    name: sheet.name,
    athleteId: sheet.athleteId,
    modelId: isPreset ? null : sheet.modelRef,
    presetKey: isPreset ? presetKeyFromId(sheet.modelRef!) : null,
    refSnExerciseId: sheet.refSnExerciseId,
    refCjExerciseId: sheet.refCjExerciseId,
    currentSn: sheet.currentSn,
    currentCj: sheet.currentCj,
    goalSn: sheet.goalSn,
    goalCj: sheet.goalCj,
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
  const rows = rec.options.rows ?? resolveModelRef(modelRef, models, exercises)?.rows ?? [];
  return {
    analysisId: rec.id,
    name: rec.name,
    athleteId: rec.athleteId,
    modelRef,
    rows,
    refSnExerciseId: rec.refSnExerciseId,
    refCjExerciseId: rec.refCjExerciseId,
    currentSn: rec.currentSn,
    currentCj: rec.currentCj,
    goalSn: rec.goalSn,
    goalCj: rec.goalCj,
    overrides: rec.istOverrides,
    heatmap: rec.options.heatmap ?? true,
    diff: rec.options.diff ?? true,
    sideModelRef: rec.options.sideModelRef ?? null,
  };
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
