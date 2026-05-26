/**
 * Compute per-exercise and per-day planned-vs-actual summaries that the
 * coach Log mode renders next to each row and at the day header.
 *
 * Inputs are intentionally light — a PlannedExercise (already carries
 * the coach's summary_*_* fields from the planner) and a
 * LoggedExerciseFull (sets + log_exercise metadata for GPP rows).
 *
 * Tone selection mirrors the existing computeDelta semantics so the
 * thresholds across coach Log mode stay coherent:
 *   ratio >= 0.95  → neutral (no tint)
 *   0.7 ≤ ratio < 0.95 → amber  (deviated somewhat)
 *   ratio < 0.7    → red    (deviated a lot)
 * "Going over plan" is treated as neutral — matches OWL coaching intent
 * (under-delivery is the worry, over-delivery rarely needs flagging).
 */
import type { PlannedExercise, GppSection } from '../../../lib/database.types';
import type { LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { getSentinelType } from '../sentinelUtils';

export type SummaryTone = 'neutral' | 'amber' | 'red' | 'pending';

export interface MetricPair {
  planned: number | null;
  actual: number | null;
  hasLog: boolean;
}

export interface ExerciseSummary {
  sets: MetricPair;
  reps: MetricPair;
  /** Average load across logged sets (kg). Null when not quantifiable
   *  (free-text, RPE, or all loads missing). */
  avgLoad: MetricPair;
  /** Heaviest single set (kg). Null when not quantifiable. */
  maxLoad: MetricPair;
}

export function toneFor(p: MetricPair): SummaryTone {
  if (!p.hasLog) return 'pending';
  const planned = p.planned ?? 0;
  const actual = p.actual ?? 0;
  if (planned <= 0) return actual > 0 ? 'neutral' : 'pending';
  const ratio = actual / planned;
  if (ratio >= 0.95) return 'neutral';
  if (ratio >= 0.7) return 'amber';
  return 'red';
}

/** Pull average and max load from a list of logged sets, ignoring rows
 *  the athlete left blank. Returns null when nothing usable was logged. */
function loadStats(sets: { performed_load: number | null }[]): {
  avg: number | null;
  max: number | null;
} {
  const numeric = sets
    .map(s => s.performed_load)
    .filter((x): x is number => typeof x === 'number' && !Number.isNaN(x));
  if (numeric.length === 0) return { avg: null, max: null };
  const sum = numeric.reduce((a, b) => a + b, 0);
  return { avg: sum / numeric.length, max: Math.max(...numeric) };
}

/** Sum performed reps from completed sets only. Pending / skipped rows
 *  don't contribute. */
function sumPerformedReps(
  sets: { performed_reps: number | null; status: string }[],
): number {
  return sets
    .filter(s => s.status === 'completed')
    .reduce((acc, s) => acc + (s.performed_reps ?? 0), 0);
}

/** Count completed sets — the unit the coach prescribed against. */
function countCompletedSets(sets: { status: string }[]): number {
  return sets.filter(s => s.status === 'completed').length;
}

/** Sum planned and athlete-completed rows on a GPP section. GPP rows
 *  carry done flags rather than per-set load/rep data; we treat each
 *  row as one set and contribute its reps. Loads on GPP are typically
 *  text ("bw", "20 kg dumbbells") so we skip them on the load axes.
 *  reps is a free-form string ("12", "10-12", "AMRAP") — we parse a
 *  leading integer and fall back to 0 when not numeric. */
function parseRepsInt(reps: string | number): number {
  if (typeof reps === 'number') return reps;
  const m = String(reps).trim().match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function gppSummary(planned: GppSection | null, athlete: GppSection | null): ExerciseSummary {
  const plannedRows = planned?.rows ?? [];
  const athleteRows = (athlete ?? planned)?.rows ?? [];
  const hasLog = athlete != null;
  const plannedSets = plannedRows.reduce((n, r) => n + (r.sets ?? 1), 0);
  const plannedReps = plannedRows.reduce(
    (n, r) => n + (r.sets ?? 1) * parseRepsInt(r.reps),
    0,
  );
  const actualSets = athleteRows.filter(r => r.done).reduce((n, r) => n + (r.sets ?? 1), 0);
  const actualReps = athleteRows
    .filter(r => r.done)
    .reduce((n, r) => n + (r.sets ?? 1) * parseRepsInt(r.reps), 0);
  return {
    sets: { planned: plannedSets, actual: hasLog ? actualSets : null, hasLog },
    reps: { planned: plannedReps, actual: hasLog ? actualReps : null, hasLog },
    avgLoad: { planned: null, actual: null, hasLog },
    maxLoad: { planned: null, actual: null, hasLog },
  };
}

export function computeExerciseSummary(
  planned: PlannedExercise | null,
  logged: LoggedExerciseFull | null,
): ExerciseSummary {
  const hasLog = logged != null;

  // GPP gets its own path because the data lives in metadata, not sets.
  const sentinel = planned ? getSentinelType((planned as PlannedExercise & { exercise_code?: string | null }).exercise_code ?? null) : null;
  if (sentinel === 'gpp') {
    const plannedGpp = planned?.metadata?.gpp ?? null;
    const athleteGpp = logged?.log.metadata?.gpp ?? null;
    return gppSummary(plannedGpp, athleteGpp);
  }

  const plannedSets = planned?.summary_total_sets ?? null;
  const plannedReps = planned?.summary_total_reps ?? null;
  const plannedAvg = planned?.summary_avg_load ?? null;
  const plannedMax = planned?.summary_highest_load ?? null;

  if (!logged) {
    return {
      sets: { planned: plannedSets, actual: null, hasLog: false },
      reps: { planned: plannedReps, actual: null, hasLog: false },
      avgLoad: { planned: plannedAvg, actual: null, hasLog: false },
      maxLoad: { planned: plannedMax, actual: null, hasLog: false },
    };
  }

  const actualSets = countCompletedSets(logged.sets);
  const actualReps = sumPerformedReps(logged.sets);
  const { avg, max } = loadStats(logged.sets.filter(s => s.status === 'completed'));

  return {
    sets: { planned: plannedSets, actual: actualSets, hasLog },
    reps: { planned: plannedReps, actual: actualReps, hasLog },
    avgLoad: { planned: plannedAvg, actual: avg, hasLog },
    maxLoad: { planned: plannedMax, actual: max, hasLog },
  };
}

/** Day-level rollup. We sum sets and reps across exercises, average the
 *  per-set loads weighted by completed sets (so a heavy single doesn't
 *  drag the mean by counting once), and take the max for highest. */
export function computeDaySummary(summaries: ExerciseSummary[]): ExerciseSummary {
  const hasLog = summaries.some(s => s.sets.hasLog);

  const sumMetric = (pick: (s: ExerciseSummary) => MetricPair): MetricPair => {
    let p = 0,
      a = 0;
    let anyPlanned = false,
      anyActual = false;
    for (const s of summaries) {
      const m = pick(s);
      if (m.planned != null) {
        p += m.planned;
        anyPlanned = true;
      }
      if (m.actual != null) {
        a += m.actual;
        anyActual = true;
      }
    }
    return {
      planned: anyPlanned ? p : null,
      actual: hasLog && anyActual ? a : null,
      hasLog,
    };
  };

  // Weighted average load = sum(avg_i * completed_i) / sum(completed_i).
  // For planned: avg_i * planned_sets_i.
  let plannedLoadWeight = 0,
    plannedLoadSum = 0;
  let actualLoadWeight = 0,
    actualLoadSum = 0;
  let plannedMax = 0,
    actualMax = 0;
  let plannedHasLoad = false,
    actualHasLoad = false;
  let plannedHasMax = false,
    actualHasMax = false;
  for (const s of summaries) {
    if (s.avgLoad.planned != null && s.sets.planned != null && s.sets.planned > 0) {
      plannedLoadSum += s.avgLoad.planned * s.sets.planned;
      plannedLoadWeight += s.sets.planned;
      plannedHasLoad = true;
    }
    if (s.avgLoad.actual != null && s.sets.actual != null && s.sets.actual > 0) {
      actualLoadSum += s.avgLoad.actual * s.sets.actual;
      actualLoadWeight += s.sets.actual;
      actualHasLoad = true;
    }
    if (s.maxLoad.planned != null) {
      plannedMax = Math.max(plannedMax, s.maxLoad.planned);
      plannedHasMax = true;
    }
    if (s.maxLoad.actual != null) {
      actualMax = Math.max(actualMax, s.maxLoad.actual);
      actualHasMax = true;
    }
  }

  return {
    sets: sumMetric(s => s.sets),
    reps: sumMetric(s => s.reps),
    avgLoad: {
      planned: plannedHasLoad && plannedLoadWeight > 0 ? plannedLoadSum / plannedLoadWeight : null,
      actual: hasLog && actualHasLoad && actualLoadWeight > 0 ? actualLoadSum / actualLoadWeight : null,
      hasLog,
    },
    maxLoad: {
      planned: plannedHasMax ? plannedMax : null,
      actual: hasLog && actualHasMax ? actualMax : null,
      hasLog,
    },
  };
}
