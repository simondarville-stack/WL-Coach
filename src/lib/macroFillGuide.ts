/**
 * macroFillGuide — pure engine for the macro-cycle fill guide.
 *
 * Model (see mockup/macro-fill-guide-v5.html, the design spec):
 *   value(week) = trend(startAnchor → endAnchor) × rhythmStep(week) / 100, rounded.
 *
 * The macro TABLE is the single source of truth: this engine only *computes*
 * cells; callers write them as ordinary macro_targets / macro_weeks values.
 * Nothing stays linked after an apply — undo is a caller-side snapshot.
 *
 * A rhythm preset is either week-type-driven (one {load, reps} multiplier per
 * coach-configured week-type abbreviation — sandbox-safe: unknown abbreviations
 * count as 100/100) or pattern-driven (a repeating step sequence, optionally
 * carrying week-type stamps to write onto the weeks).
 *
 * No Supabase, no React — keep it that way so it stays unit-testable and can
 * back the fill popup, re-modulate, and (later) macro templates unchanged.
 */
import type { RhythmPreset, RhythmStep, WeekTypeConfig } from './database.types';

/** Week input — a projection of MacroWeek plus caller knowledge of existing data. */
export interface FillWeek {
  /** 1-based week number within the macro (macro_weeks.week_number). */
  weekNumber: number;
  /** Current week-type abbreviation on the week (macro_weeks.week_type). */
  weekType: string;
  /** Does the target already hold a coach value for this week? (skipped unless overwrite) */
  hasExisting?: boolean;
}

export interface FillAnchors {
  fromWeek: number;
  fromValue: number;
  toWeek: number;
  toValue: number;
}

export interface ExerciseFillOptions {
  /** Load anchors — kg when unit is 'kg', % of referenceKg when 'pct'. */
  anchors: FillAnchors;
  unit: 'kg' | 'pct';
  /** Required when unit is 'pct'; ignored for 'kg'. */
  referenceKg?: number | null;
  /** Weekly total-reps trend endpoints (same anchor weeks as the load); null/undefined = don't fill reps. */
  repsAnchors?: { fromValue: number; toValue: number } | null;
  /** Avg = max × (1 − mirrorPct/100); null/undefined = don't fill avg. */
  mirrorPct?: number | null;
  /** Overwrite weeks that already hold coach values (default false). */
  overwrite?: boolean;
  /** Write the rhythm's week-type stamps onto the weeks (pattern presets only). */
  stamp?: boolean;
  /** Load rounding step in kg (default 2.5). */
  loadRoundingKg?: number;
}

export interface FillCell {
  max: number;
  avg?: number;
  reps?: number;
}

export interface ExerciseFillResult {
  /** weekNumber → generated values. Weeks outside the anchor range or skipped are absent. */
  cells: Map<number, FillCell>;
  /** weekNumber → week-type abbreviation to stamp (empty unless stamping applies). */
  stamps: Map<number, string>;
}

export interface GeneralFillOptions {
  /** Anchors in the metric's own unit (e.g. Σreps). Modulated by the rhythm's reps %. */
  anchors: FillAnchors;
  overwrite?: boolean;
  stamp?: boolean;
  /** Rounding step (default 5 — Σreps granularity). */
  rounding?: number;
}

export interface GeneralFillResult {
  values: Map<number, number>;
  stamps: Map<number, string>;
}

export const DEFAULT_LOAD_ROUNDING_KG = 2.5;
export const DEFAULT_GENERAL_ROUNDING = 5;

export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

/**
 * A preset may only stamp week types if every stamp it carries exists in the
 * coach's configured week types (sandbox rule: degrade gracefully, never write
 * an abbreviation the coach doesn't have). Presets without stamps can't stamp.
 */
export function stampAllowed(rhythm: RhythmPreset, weekTypes: WeekTypeConfig[]): boolean {
  if (rhythm.mode !== 'pattern' || !rhythm.stampTypes) return false;
  const real = rhythm.stampTypes.filter((s): s is string => !!s);
  if (real.length === 0) return false;
  const known = new Set(weekTypes.map(t => t.abbreviation));
  return real.every(s => known.has(s));
}

const NEUTRAL_STEP: RhythmStep = { load: 100, reps: 100 };

interface ResolvedWeek {
  step: RhythmStep;
  stamp: string | null;
}

/**
 * Resolve the rhythm to one {load, reps} step (and optional stamp) per week in
 * the anchor range. Pattern presets index from the first in-range week and
 * repeat; week-type presets look up each week's current type.
 */
function resolveWeeks(
  weeks: FillWeek[],
  rhythm: RhythmPreset,
  anchors: FillAnchors,
): Map<number, ResolvedWeek> {
  const out = new Map<number, ResolvedWeek>();
  const lo = Math.min(anchors.fromWeek, anchors.toWeek);
  const hi = Math.max(anchors.fromWeek, anchors.toWeek);
  const inRange = weeks
    .filter(w => w.weekNumber >= lo && w.weekNumber <= hi)
    .sort((a, b) => a.weekNumber - b.weekNumber);

  let patIdx = 0;
  for (const wk of inRange) {
    if (rhythm.mode === 'weektype') {
      out.set(wk.weekNumber, { step: rhythm.mult?.[wk.weekType] ?? NEUTRAL_STEP, stamp: null });
    } else {
      const pattern = rhythm.pattern && rhythm.pattern.length > 0 ? rhythm.pattern : [NEUTRAL_STEP];
      const step = pattern[patIdx % pattern.length];
      const stamp = rhythm.stampTypes?.[patIdx % pattern.length] ?? null;
      out.set(wk.weekNumber, { step, stamp });
      patIdx++;
    }
  }
  return out;
}

function trendAt(anchors: FillAnchors, weekNumber: number): number {
  const t = (weekNumber - anchors.fromWeek) / (anchors.toWeek - anchors.fromWeek);
  return anchors.fromValue + (anchors.toValue - anchors.fromValue) * t;
}

/**
 * Compute a fill for one exercise target. Pure: returns generated cells and
 * stamps; the caller decides how to write them (and what "existing" means).
 *
 * Degenerate anchors (fromWeek === toWeek) yield an empty result rather than
 * dividing by zero — the guide UI treats that as "check the anchors".
 */
export function computeExerciseFill(
  weeks: FillWeek[],
  rhythm: RhythmPreset,
  weekTypes: WeekTypeConfig[],
  opts: ExerciseFillOptions,
): ExerciseFillResult {
  const cells = new Map<number, FillCell>();
  const stamps = new Map<number, string>();
  const { anchors } = opts;
  if (anchors.fromWeek === anchors.toWeek) return { cells, stamps };
  if (opts.unit === 'pct' && !(opts.referenceKg && opts.referenceKg > 0)) return { cells, stamps };

  const rounding = opts.loadRoundingKg ?? DEFAULT_LOAD_ROUNDING_KG;
  const canStamp = (opts.stamp ?? false) && stampAllowed(rhythm, weekTypes);
  const resolved = resolveWeeks(weeks, rhythm, anchors);
  const byNumber = new Map(weeks.map(w => [w.weekNumber, w]));

  for (const [weekNumber, { step, stamp }] of resolved) {
    if (canStamp && stamp) stamps.set(weekNumber, stamp);

    const week = byNumber.get(weekNumber);
    if (week?.hasExisting && !(opts.overwrite ?? false)) continue;

    const loadTrend = trendAt(anchors, weekNumber);
    const kgTrend = opts.unit === 'pct' ? (opts.referenceKg as number) * loadTrend / 100 : loadTrend;
    const max = Math.max(0, roundToStep(kgTrend * step.load / 100, rounding));
    const cell: FillCell = { max };

    if (opts.mirrorPct != null) {
      cell.avg = Math.max(0, roundToStep(max * (1 - opts.mirrorPct / 100), rounding));
    }
    if (opts.repsAnchors) {
      const repsTrend = trendAt(
        {
          fromWeek: anchors.fromWeek,
          toWeek: anchors.toWeek,
          fromValue: opts.repsAnchors.fromValue,
          toValue: opts.repsAnchors.toValue,
        },
        weekNumber,
      );
      cell.reps = Math.max(0, Math.round(repsTrend * step.reps / 100));
    }
    cells.set(weekNumber, cell);
  }
  return { cells, stamps };
}

/**
 * Compute a fill for a week-level general metric (Σreps, tonnage target, …).
 * Uses the rhythm's reps multiplier — general metrics are volume-like.
 */
export function computeGeneralFill(
  weeks: FillWeek[],
  rhythm: RhythmPreset,
  weekTypes: WeekTypeConfig[],
  opts: GeneralFillOptions,
): GeneralFillResult {
  const values = new Map<number, number>();
  const stamps = new Map<number, string>();
  const { anchors } = opts;
  if (anchors.fromWeek === anchors.toWeek) return { values, stamps };

  const rounding = opts.rounding ?? DEFAULT_GENERAL_ROUNDING;
  const canStamp = (opts.stamp ?? false) && stampAllowed(rhythm, weekTypes);
  const resolved = resolveWeeks(weeks, rhythm, anchors);
  const byNumber = new Map(weeks.map(w => [w.weekNumber, w]));

  for (const [weekNumber, { step, stamp }] of resolved) {
    if (canStamp && stamp) stamps.set(weekNumber, stamp);
    const week = byNumber.get(weekNumber);
    if (week?.hasExisting && !(opts.overwrite ?? false)) continue;
    const trend = trendAt(anchors, weekNumber);
    values.set(weekNumber, Math.max(0, roundToStep(trend * step.reps / 100, rounding)));
  }
  return { values, stamps };
}

/**
 * Mirror helper shared by the guide and the graph: the avg that corresponds to
 * a max under the given mirror percentage, rounded like a load.
 */
export function mirroredAvg(
  max: number,
  mirrorPct: number,
  loadRoundingKg: number = DEFAULT_LOAD_ROUNDING_KG,
): number {
  return Math.max(0, roundToStep(max * (1 - mirrorPct / 100), loadRoundingKg));
}
