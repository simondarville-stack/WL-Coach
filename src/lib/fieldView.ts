/**
 * fieldView — domain logic for the coach Field View (/field).
 *
 * Two pure pieces, no Supabase access (the useFieldWeek hook feeds them):
 *
 *  - resolveNextSession: which training slot is an athlete's "next" one.
 *    Slots with an assigned weekday (week_plans.day_schedule) resolve
 *    precisely against today's weekday; unassigned slots resolve to the
 *    lowest-ordered unit that hasn't been logged ("next one coming up").
 *
 *  - summarizeSession: the compact per-exercise rows for an Upcoming card
 *    (code / name / total reps / total sets / top segment / avg), with
 *    percentage loads resolved to kilograms through the athlete's cached
 *    reference max, and a coach-configurable "heavy" bold threshold.
 */
import {
  parsePrescription,
  parseComboPrescription,
  computePrescriptionSummary,
} from './prescriptionParser';
import { roundToHalf } from './xrmUtils';
import { getSentinelType } from '../components/planner/sentinelUtils';
import { hasLoggedWork, isExerciseDone } from './trainingLogModel';
import { expectedPlannedSetCount } from './plannedSetCount';
import type { DayLog, LoggedExerciseFull } from './trainingLogModel';
import type { Exercise, TrainingLogSession } from './database.types';
import type {
  PlannedExerciseFull,
  WeekDayOverview,
  WeekOverview,
} from './trainingLogService';

// ─── Next-session resolution ───────────────────────────────────────────────

export type NextSessionKind =
  | 'today'          // assigned to today's weekday, not yet completed
  | 'next_up'        // unassigned slot; the next one coming up in unit order
  | 'scheduled'      // assigned to a later weekday this week
  | 'overdue'        // assigned to an earlier weekday but never logged
  | 'week_complete'  // every planned slot is completed or skipped
  | 'no_plan';       // no planned exercises this week

export interface NextSessionResolution {
  kind: NextSessionKind;
  /** The resolved slot; null for week_complete / no_plan. */
  day: WeekDayOverview | null;
}

/**
 * Preference order when several slots remain open:
 *   1. a slot assigned to today's weekday;
 *   2. the first unassigned slot in unit order (it can happen any day,
 *      including today, so it beats a strictly-future assigned day);
 *   3. the earliest upcoming assigned slot;
 *   4. the earliest past assigned slot (overdue — the coach sees the
 *      past date and reads it as missed).
 * Athlete-added bonus slots never count as the coach's "next" session.
 */
export function resolveNextSession(
  overview: WeekOverview | null,
  todayWeekday: number,
): NextSessionResolution {
  const plannedDays = (overview?.days ?? []).filter(
    d => d.plannedCount > 0 && !d.isBonus,
  );
  if (plannedDays.length === 0) return { kind: 'no_plan', day: null };

  const open = plannedDays.filter(
    d => d.status !== 'completed' && d.status !== 'skipped',
  );
  if (open.length === 0) return { kind: 'week_complete', day: null };

  const todaySlot = open.find(d => d.weekday === todayWeekday);
  if (todaySlot) return { kind: 'today', day: todaySlot };

  const unassigned = open.find(d => d.weekday == null);
  if (unassigned) return { kind: 'next_up', day: unassigned };

  const upcoming = open
    .filter(d => d.weekday != null && d.weekday > todayWeekday)
    .sort((a, b) => a.weekday! - b.weekday!);
  if (upcoming.length > 0) return { kind: 'scheduled', day: upcoming[0] };

  const past = open
    .filter(d => d.weekday != null && d.weekday < todayWeekday)
    .sort((a, b) => a.weekday! - b.weekday!);
  return { kind: 'overdue', day: past[0] };
}

// ─── Missed-day detection ──────────────────────────────────────────────────

/**
 * Slots the athlete has missed so far this week: explicitly skipped slots
 * (a logged "not done" decision, whatever their weekday), plus slots
 * assigned to a weekday strictly before today that were never logged at
 * all. Athlete-added bonus slots and empty slots don't count. Days in the
 * future — or today itself — are never "missed".
 */
export function findMissedDays(
  overview: WeekOverview | null,
  todayWeekday: number,
): WeekDayOverview[] {
  return (overview?.days ?? []).filter(d => {
    if (d.isBonus || d.plannedCount === 0) return false;
    if (d.status === 'skipped') return true;
    return d.weekday != null && d.weekday < todayWeekday && !d.hasLog;
  });
}

// ─── Compact session summary ───────────────────────────────────────────────

export interface FieldExerciseRow {
  key: string;
  code: string | null;
  name: string;
  isCombo: boolean;
  totalReps: number;
  totalSets: number;
  /** Reconstructed prescription text for the heaviest segment only, in the
   *  input grammar, so StackedNotation renders it canonically. Null when the
   *  prescription has no numeric loads (free text / RPE prose). */
  topRaw: string | null;
  unit: string | null;
  /** Top load resolved to kilograms (percentage via reference max). Null
   *  when unresolvable or already absolute. */
  topKg: number | null;
  /** Weighted average load in the prescription's native unit. */
  avgValue: number | null;
  /** Average resolved to kilograms when the unit is percentage. */
  avgKg: number | null;
  /** True when any line reaches the coach's bold threshold (percentage
   *  directly, or absolute kg measured against the reference max). */
  isHeavy: boolean;
}

export interface FieldSummaryOptions {
  /** Intensity (%) at or above which a row renders bold. */
  boldPct: number;
  /** Mirror of general_settings percent_to_kg rounding. */
  roundEnabled: boolean;
  roundIncrement: number;
  /** Cached reference max (athlete_prs, via pr_reference_exercise_id ?? self). */
  oneRmFor: (exercise: Exercise) => number | null;
}

function roundKg(kg: number, opts: FieldSummaryOptions): number {
  if (opts.roundEnabled && opts.roundIncrement > 0) {
    return Math.round(kg / opts.roundIncrement) * opts.roundIncrement;
  }
  return roundToHalf(kg);
}

function pctToKg(pct: number, oneRm: number | null, opts: FieldSummaryOptions): number | null {
  if (oneRm == null || oneRm <= 0) return null;
  return roundKg((pct / 100) * oneRm, opts);
}

interface Segment {
  load: number;
  loadMax: number | null;
  repsDisplay: string;
  sets: number;
}

/** Numeric segments of a prescription, combo tuples preserved. */
function numericSegments(raw: string, isCombo: boolean): Segment[] {
  if (isCombo) {
    return parseComboPrescription(raw)
      .filter(l => l.loadText == null)
      .map(l => ({ load: l.load, loadMax: l.loadMax, repsDisplay: l.repsText, sets: l.sets }));
  }
  return parsePrescription(raw).map(l => ({
    load: l.load,
    loadMax: l.loadMax ?? null,
    repsDisplay: String(l.reps),
    sets: l.sets,
  }));
}

/** Rebuild input-grammar text for one segment ("85x2x3", "80-90x2", "80x2+1x3"). */
function segmentRaw(s: Segment): string {
  const load = s.loadMax != null ? `${s.load}-${s.loadMax}` : String(s.load);
  return s.sets > 1 ? `${load}x${s.repsDisplay}x${s.sets}` : `${load}x${s.repsDisplay}`;
}

export function summarizeSession(
  planned: PlannedExerciseFull[],
  opts: FieldSummaryOptions,
): FieldExerciseRow[] {
  const rows: FieldExerciseRow[] = [];
  for (const pe of planned) {
    if (getSentinelType(pe.exerciseDef?.exercise_code ?? null)) continue;
    const raw = pe.exercise.prescription_raw ?? '';
    const unit = pe.exercise.unit;
    const isCombo = pe.exercise.is_combo;

    const summary = computePrescriptionSummary(raw, unit, isCombo);
    const segments = numericSegments(raw, isCombo);
    const top = segments.reduce<Segment | null>(
      (best, s) =>
        best == null || (s.loadMax ?? s.load) > (best.loadMax ?? best.load) ? s : best,
      null,
    );

    // Combos aggregate several movements; a single reference max is not
    // well-defined, so kg resolution and absolute-kg bolding are skipped.
    const oneRm = !isCombo && pe.exerciseDef ? opts.oneRmFor(pe.exerciseDef) : null;
    const topLoad = top ? top.loadMax ?? top.load : null;

    let topKg: number | null = null;
    let avgKg: number | null = null;
    let isHeavy = false;
    if (unit === 'percentage') {
      if (topLoad != null) {
        topKg = pctToKg(topLoad, oneRm, opts);
        isHeavy = topLoad >= opts.boldPct;
      }
      if (summary.avg_load != null) avgKg = pctToKg(summary.avg_load, oneRm, opts);
    } else if (unit === 'absolute_kg' && topLoad != null && oneRm != null && oneRm > 0) {
      isHeavy = (topLoad / oneRm) * 100 >= opts.boldPct;
    }

    rows.push({
      key: pe.exercise.id,
      code: pe.exerciseDef?.exercise_code ?? null,
      name: pe.exerciseDef?.name ?? 'Unknown',
      isCombo,
      totalReps: summary.total_reps,
      totalSets: summary.total_sets,
      topRaw: top ? segmentRaw(top) : null,
      unit,
      topKg,
      avgValue: summary.avg_load != null ? roundToHalf(summary.avg_load) : null,
      avgKg,
      isHeavy,
    });
  }
  return rows;
}

/** Default bold threshold when the coach hasn't configured one. */
export const DEFAULT_FIELD_BOLD_PCT = 90;

// ─── Live session progress ─────────────────────────────────────────────────

export interface SessionProgress {
  /** Planned exercises the athlete has finished (canonical isExerciseDone). */
  done: number;
  /** Loggable planned exercises in the slot (display-only sentinels excluded). */
  total: number;
}

/**
 * Whether a slot's log session counts as "live" on an Upcoming card:
 * explicitly in progress, or already carrying real logged work (an athlete
 * can complete exercises without the session ever leaving 'pending').
 */
export function isSessionLive(log: DayLog | null): boolean {
  if (!log?.session) return false;
  return log.session.status === 'in_progress' || hasLoggedWork(log);
}

/**
 * n/m exercise progress for one training slot.
 *
 * m counts the coach-planned exercises the athlete can actually log:
 * display-only sentinels (TEXT / IMAGE / VIDEO) are excluded, GPP blocks are
 * included (they complete via explicit "Mark complete"). Off-plan additions
 * are deliberately not counted — the card reads "how far through the plan".
 * Done-ness is the canonical isExerciseDone with the same planned-set count
 * the athlete app uses for auto-promotion (expectedPlannedSetCount).
 */
/**
 * RAW readiness total (Eleiko: four pillars each rated 1–3, sum 4–12) for
 * a logged session. Sums the pillar columns when the athlete rated all
 * four; falls back to the stored raw_total; null when RAW wasn't logged.
 */
export function sessionRawTotal(session: TrainingLogSession | null): number | null {
  if (!session) return null;
  const pillars = [session.raw_sleep, session.raw_physical, session.raw_mood, session.raw_nutrition];
  if (pillars.every(p => p != null)) {
    return (pillars as number[]).reduce((a, b) => a + b, 0);
  }
  return session.raw_total ?? null;
}

export function countSessionProgress(
  planned: PlannedExerciseFull[],
  log: DayLog | null,
): SessionProgress {
  const loggedByPlannedId = new Map<string, LoggedExerciseFull>();
  for (const le of log?.exercises ?? []) {
    if (le.log.planned_exercise_id) loggedByPlannedId.set(le.log.planned_exercise_id, le);
  }
  let done = 0;
  let total = 0;
  for (const pe of planned) {
    const sentinel = getSentinelType(pe.exerciseDef?.exercise_code ?? null);
    if (sentinel && sentinel !== 'gpp') continue;
    total += 1;
    const le = loggedByPlannedId.get(pe.exercise.id) ?? null;
    if (isExerciseDone(le, expectedPlannedSetCount(pe))) done += 1;
  }
  return { done, total };
}
