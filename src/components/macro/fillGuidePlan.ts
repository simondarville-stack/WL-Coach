/**
 * fillGuidePlan — maps fill-guide inputs onto the macro data model.
 *
 * The pure engine (src/lib/macroFillGuide.ts) speaks week numbers and abstract
 * cells; this module resolves targets (a tracked exercise, all exercises
 * proportionally, or the general Σreps metric), decides what "existing" means
 * per cell, and emits a concrete write plan of macro_targets rows and
 * macro_weeks updates. Re-modulate re-runs buildFillPlan with the same inputs
 * against the current week types — the table stays plain data throughout.
 */
import { isNumericUnit, unitOf } from '../../lib/macroTargetUnit';
import type {
  MacroTarget,
  MacroTrackedExerciseWithExercise,
  MacroWeek,
  RhythmPreset,
  WeekTypeConfig,
} from '../../lib/database.types';
import {
  DEFAULT_LOAD_ROUNDING_PCT,
  computeExerciseFill,
  computeGeneralFill,
  type FillCell,
  type FillWeek,
  type TrendModel,
} from '../../lib/macroFillGuide';

/** Special fill targets beside a tracked-exercise id. */
export const FILL_TARGET_ALL = 'all' as const;
export const FILL_TARGET_SREPS = 'general_sreps' as const;

export interface FillGuideInputs {
  /** Tracked-exercise id, FILL_TARGET_ALL, or FILL_TARGET_SREPS. */
  target: string;
  unit: 'kg' | 'pct';
  fromWeek: number;
  fromValue: number;
  toWeek: number;
  toValue: number;
  /** Progression shape between the anchors; omitted = the historical straight ramp. */
  trend?: TrendModel | null;
  fillReps: boolean;
  repsFrom: number;
  repsTo: number;
  mirror: boolean;
  mirrorPct: number;
  overwrite: boolean;
  stamp: boolean;
  loadRoundingKg: number;
  /** Working copy of the rhythm — per-fill tweaks never write back to the preset. */
  rhythm: RhythmPreset;
}

export interface FillGuidePreview {
  /** trackedExerciseId → macro_week_id → generated cell */
  byTrackedEx: Record<string, Record<string, FillCell>>;
  /** macro_week_id → week-type abbreviation to stamp */
  weekTypeStamps: Record<string, string>;
  /** macro_week_id → Σreps value (general fills) */
  totalReps: Record<string, number>;
  /**
   * Draggable ramp anchors (single-exercise fills only) — positions for the
   * chart's ◆ handles, on the chart's shared value axis. For a kilogram column
   * those are kilograms; for a percentage column they are percentages, which
   * sit at the same heights because a % series already shares the kg axis.
   */
  anchors?: {
    trackedExId: string;
    fromWeekNumber: number;
    toWeekNumber: number;
    fromKg: number;
    toKg: number;
    /** What `fromKg`/`toKg` are actually in, so the guide can invert a drag. */
    unit: 'kg' | 'pct';
  } | null;
}

export interface FillWritePlan {
  targetRows: Array<{
    macro_week_id: string;
    tracked_exercise_id: string;
    fields: Partial<MacroTarget>;
  }>;
  weekUpdates: Array<{ id: string } & Partial<Pick<MacroWeek, 'week_type' | 'total_reps_target'>>>;
  /** Exercise names skipped in an all-exercises fill because they have no reference. */
  skippedNoReference: string[];
  /** Exercise names skipped because their column holds prose, not numbers.
   *  A fill computes a value; there is nothing to compute for free text. */
  skippedFreeText: string[];
  /** In-range weeks skipped because they already hold values (overwrite off) —
   *  lets the guide say "tick Overwrite" instead of a generic hint. */
  skippedExisting: number;
  cellCount: number;
  preview: FillGuidePreview;
}

function toFillWeeks(
  macroWeeks: MacroWeek[],
  hasExisting: (week: MacroWeek) => boolean,
): FillWeek[] {
  return macroWeeks.map(w => ({
    weekNumber: w.week_number,
    weekType: w.week_type,
    hasExisting: hasExisting(w),
  }));
}

export function buildFillPlan(
  inputs: FillGuideInputs,
  macroWeeks: MacroWeek[],
  trackedExercises: MacroTrackedExerciseWithExercise[],
  targets: MacroTarget[],
  weekTypes: WeekTypeConfig[],
): FillWritePlan {
  const preview: FillGuidePreview = { byTrackedEx: {}, weekTypeStamps: {}, totalReps: {} };
  const plan: FillWritePlan = {
    targetRows: [],
    weekUpdates: [],
    skippedNoReference: [],
    skippedFreeText: [],
    skippedExisting: 0,
    cellCount: 0,
    preview,
  };
  const inRange = (weekNumber: number): boolean => {
    const lo = Math.min(inputs.fromWeek, inputs.toWeek);
    const hi = Math.max(inputs.fromWeek, inputs.toWeek);
    return weekNumber >= lo && weekNumber <= hi;
  };
  const weekByNumber = new Map(macroWeeks.map(w => [w.week_number, w]));
  // Merged per-week updates — a week may receive both a Σreps value and a stamp.
  const weekUpdateMap = new Map<string, Partial<Pick<MacroWeek, 'week_type' | 'total_reps_target'>>>();
  const anchors = {
    fromWeek: inputs.fromWeek,
    fromValue: inputs.fromValue,
    toWeek: inputs.toWeek,
    toValue: inputs.toValue,
  };
  const stampByWeekId = new Map<string, string>();

  const collectStamps = (stamps: Map<number, string>) => {
    for (const [weekNumber, abbr] of stamps) {
      const week = weekByNumber.get(weekNumber);
      if (week && week.week_type !== abbr) stampByWeekId.set(week.id, abbr);
      else if (week) stampByWeekId.delete(week.id); // already that type — nothing to write
    }
  };

  if (inputs.target === FILL_TARGET_SREPS) {
    const weeks = toFillWeeks(macroWeeks, w => w.total_reps_target != null);
    if (!inputs.overwrite) {
      plan.skippedExisting += weeks.filter(w => inRange(w.weekNumber) && w.hasExisting).length;
    }
    const res = computeGeneralFill(weeks, inputs.rhythm, weekTypes, {
      anchors,
      trend: inputs.trend,
      overwrite: inputs.overwrite,
      stamp: inputs.stamp,
    });
    collectStamps(res.stamps);
    for (const [weekNumber, value] of res.values) {
      const week = weekByNumber.get(weekNumber);
      if (!week) continue;
      preview.totalReps[week.id] = value;
      weekUpdateMap.set(week.id, { ...weekUpdateMap.get(week.id), total_reps_target: value });
      plan.cellCount++;
    }
  } else {
    const exList = inputs.target === FILL_TARGET_ALL
      ? trackedExercises
      : trackedExercises.filter(te => te.id === inputs.target);
    for (const te of exList) {
      const colUnit = unitOf(te);
      if (!isNumericUnit(colUnit)) {
        plan.skippedFreeText.push(te.exercise.exercise_code || te.exercise.name);
        continue;
      }
      const isAll = inputs.target === FILL_TARGET_ALL;

      // The unit the fill WRITES follows the column — a percentage column gets
      // percentages, which is what makes "85 / 90 / 92,5 / deload" writable as
      // a rhythm instead of by hand.
      const outUnit: 'kg' | 'pct' = colUnit === 'percentage' ? 'pct' : 'kg';

      // The unit the coach's anchors are IN. An all-exercises fill is always
      // proportional; a percentage column always takes percentages, because its
      // output is percentages and converting kg anchors into them would need a
      // reference to say something the column already says.
      const anchorUnit: 'kg' | 'pct' = outUnit === 'pct' || isAll ? 'pct' : inputs.unit;

      // A reference is needed ONLY to cross between the two. Same unit in and
      // out means no reference, no conversion, and nothing to skip for.
      const converts = anchorUnit !== outUnit;
      const reference = te.reference_kg;
      if (converts && !(reference && reference > 0)) {
        plan.skippedNoReference.push(te.exercise.exercise_code || te.exercise.name);
        continue;
      }
      const existingByWeekId = new Map(
        targets
          .filter(t => t.tracked_exercise_id === te.id)
          .map(t => [t.macro_week_id, t]),
      );
      const weeks = toFillWeeks(
        macroWeeks,
        w => existingByWeekId.get(w.id)?.target_max != null,
      );
      if (!inputs.overwrite) {
        plan.skippedExisting += weeks.filter(w => inRange(w.weekNumber) && w.hasExisting).length;
      }
      const res = computeExerciseFill(weeks, inputs.rhythm, weekTypes, {
        anchors,
        trend: inputs.trend,
        // 'kg' is the engine's identity pass-through, so it is what a fill whose
        // anchors are already in the output unit asks for — including a % fill.
        unit: converts ? 'pct' : 'kg',
        referenceKg: converts ? reference : undefined,
        repsAnchors: inputs.fillReps ? { fromValue: inputs.repsFrom, toValue: inputs.repsTo } : null,
        mirrorPct: inputs.mirror ? inputs.mirrorPct : null,
        overwrite: inputs.overwrite,
        stamp: inputs.stamp,
        // The coach's kg grid is a barbell fact; percentages get their own.
        loadRoundingKg: outUnit === 'pct' ? DEFAULT_LOAD_ROUNDING_PCT : inputs.loadRoundingKg,
      });
      collectStamps(res.stamps);
      const cellsByWeekId: Record<string, FillCell> = {};
      for (const [weekNumber, cell] of res.cells) {
        const week = weekByNumber.get(weekNumber);
        if (!week) continue;
        cellsByWeekId[week.id] = cell;
        const fields: Partial<MacroTarget> = { target_max: cell.max };
        if (inputs.mirror) fields.target_avg = cell.avg ?? null;
        if (inputs.fillReps) fields.target_reps = cell.reps ?? null;
        plan.targetRows.push({
          macro_week_id: week.id,
          tracked_exercise_id: te.id,
          fields,
        });
        plan.cellCount++;
      }
      if (Object.keys(cellsByWeekId).length > 0) preview.byTrackedEx[te.id] = cellsByWeekId;

      // Ramp anchors for the chart's draggable ◆ handles (single-exercise fills)
      if (!isAll) {
        // The ◆ handles sit on the chart's shared value axis, so an anchor has
        // to be expressed in the OUTPUT unit — the same one the series is
        // plotted in — not always in kilograms.
        const toAxis = (v: number): number | null =>
          converts ? (reference && reference > 0 ? (reference * v) / 100 : null) : v;
        const fromKg = toAxis(inputs.fromValue);
        const toKg = toAxis(inputs.toValue);
        preview.anchors = fromKg != null && toKg != null
          ? {
              trackedExId: te.id,
              fromWeekNumber: inputs.fromWeek,
              toWeekNumber: inputs.toWeek,
              fromKg,
              toKg,
              unit: outUnit,
            }
          : null;
      }
    }
  }

  for (const [weekId, abbr] of stampByWeekId) {
    preview.weekTypeStamps[weekId] = abbr;
    weekUpdateMap.set(weekId, { ...weekUpdateMap.get(weekId), week_type: abbr });
  }
  plan.weekUpdates = Array.from(weekUpdateMap, ([id, fields]) => ({ id, ...fields }));
  return plan;
}
