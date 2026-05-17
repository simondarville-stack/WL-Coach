/**
 * trainingLogModel — domain types and pure helpers for the Training Log.
 *
 * Pure module: no Supabase, no React. Delta calculations and aggregations
 * live here so they can be unit-tested and reused by both the coach Log
 * mode view and the athlete app.
 */
import type {
  TrainingLogSession,
  TrainingLogExercise,
  TrainingLogSet,
  TrainingLogMessage,
  Exercise,
} from './database.types';

// ─── Status enums ──────────────────────────────────────────────────────────

export const SESSION_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const EXERCISE_STATUSES = ['pending', 'in_progress', 'completed', 'skipped'] as const;
export type ExerciseStatus = (typeof EXERCISE_STATUSES)[number];

export const SET_STATUSES = ['pending', 'completed', 'skipped', 'failed'] as const;
export type SetStatus = (typeof SET_STATUSES)[number];

// ─── Delta thresholds (coach-configurable in P7) ──────────────────────────

export type DeltaState = 'matched' | 'amber' | 'red' | 'pending';

export interface DeltaThresholds {
  /** ratio at which delta turns amber (default 0.70 = 70% of planned) */
  amberMin: number;
  /** ratio at which delta turns green (default 0.95 = within 5% of planned) */
  matchedMin: number;
}

export const DEFAULT_DELTA_THRESHOLDS: DeltaThresholds = {
  amberMin: 0.7,
  matchedMin: 0.95,
};

// ─── Aggregated day view (returned by service) ────────────────────────────

export interface LoggedExerciseFull {
  log: TrainingLogExercise;
  sets: TrainingLogSet[];
  exercise: Exercise | null; // null if the underlying exercise was deleted
}

export interface DayLog {
  date: string;
  dayIndex: number;
  session: TrainingLogSession | null;
  exercises: LoggedExerciseFull[];
  messages: TrainingLogMessage[];
}

// ─── Aggregation helpers ──────────────────────────────────────────────────

export function sumPerformedReps(sets: TrainingLogSet[]): number {
  return sets
    .filter(s => s.status === 'completed')
    .reduce((total, s) => total + (s.performed_reps ?? 0), 0);
}

export function avgPerformedLoad(sets: TrainingLogSet[]): number {
  const done = sets.filter(s => s.status === 'completed' && s.performed_load != null);
  if (done.length === 0) return 0;
  const weightedSum = done.reduce(
    (total, s) => total + (s.performed_load ?? 0) * (s.performed_reps ?? 0),
    0,
  );
  const totalReps = done.reduce((total, s) => total + (s.performed_reps ?? 0), 0);
  return totalReps > 0 ? weightedSum / totalReps : 0;
}

// ─── RAW score: Eleiko-style readiness model ───────────────────────────────

/**
 * RAW = Readiness Assessment for Weightlifting (Eleiko style).
 *
 * Four 1–5 sub-scales summed to 4–20. Coach-flex axes map to the four
 * existing nullable columns on training_log_sessions; only the labels
 * (and the guidance band table) change. No migration needed yet.
 *
 * Mapping from DB column → Eleiko axis is fixed here. If a coach
 * eventually wants different labels, this constant is the swap point
 * (P7 follow-up to expose in GeneralSettings).
 */
export interface RawAxis {
  /** DB column on training_log_sessions (raw_<key>). */
  key: 'sleep' | 'physical' | 'mood' | 'nutrition';
  label: string;
  /** Hint text rendered under the label. */
  description: string;
  /** Inclusive min score (always 1 for now). */
  min: number;
  /** Inclusive max score. */
  max: number;
}

export const ELEIKO_RAW_AXES: RawAxis[] = [
  { key: 'sleep', label: 'Sleep', description: 'Quality and duration last night', min: 1, max: 5 },
  { key: 'physical', label: 'Energy', description: 'Physical energy and freshness', min: 1, max: 5 },
  { key: 'nutrition', label: 'Soreness', description: '5 = no soreness, 1 = very sore', min: 1, max: 5 },
  { key: 'mood', label: 'Stress', description: '5 = relaxed, 1 = very stressed', min: 1, max: 5 },
];

export type RawBand = 'green' | 'lime' | 'amber' | 'red';

export interface RawGuidance {
  band: RawBand;
  /** Short status word for the chip. */
  label: string;
  /** Coach-facing recommendation rendered next to the score. */
  advice: string;
  /** Suggested multiplier on planned top-set load. 1.0 means no change. */
  intensityAdjustment: number;
}

interface RawGuidanceBand extends RawGuidance {
  min: number;
  max: number;
}

/**
 * Eleiko-style guidance bands. Total in [4, 20].
 * Tuned to the four 1–5 axes; if axes ever expand to five or shift
 * scale, recompute boundaries.
 */
export const ELEIKO_RAW_BANDS: RawGuidanceBand[] = [
  {
    min: 18, max: 20,
    band: 'green', label: 'Ready',
    advice: 'Push as planned. Good day to attempt the top of the prescribed range.',
    intensityAdjustment: 1.0,
  },
  {
    min: 14, max: 17,
    band: 'lime', label: 'Solid',
    advice: 'Train as planned. Stay attentive on the heavy sets.',
    intensityAdjustment: 1.0,
  },
  {
    min: 10, max: 13,
    band: 'amber', label: 'Below par',
    advice: 'Cap top-set intensity around 90% of planned. Cut accessory volume if it feels heavy.',
    intensityAdjustment: 0.9,
  },
  {
    min: 4, max: 9,
    band: 'red', label: 'Compromised',
    advice: 'Light technique session, or skip and rest. Tell your coach.',
    intensityAdjustment: 0.8,
  },
];

export function getRawGuidance(total: number | null): RawGuidance | null {
  if (total == null) return null;
  return ELEIKO_RAW_BANDS.find(b => total >= b.min && total <= b.max) ?? null;
}

export function rawAxisRange(): { min: number; max: number } {
  const sum = (op: 'min' | 'max') => ELEIKO_RAW_AXES.reduce((s, a) => s + a[op], 0);
  return { min: sum('min'), max: sum('max') };
}

export interface DeltaResult {
  state: DeltaState;
  performedReps: number;
  plannedReps: number;
  /** performed / planned; 0 if planned is 0 */
  ratio: number;
}

/**
 * Compare planned total reps against performed total reps and emit a delta
 * state. "Pending" means nothing was logged yet, not "skipped" — skipped
 * is a logged choice that returns 'red'.
 */
export function computeDelta(
  plannedTotalReps: number | null,
  performedReps: number,
  hasLog: boolean,
  thresholds: DeltaThresholds = DEFAULT_DELTA_THRESHOLDS,
): DeltaResult {
  if (!hasLog) return { state: 'pending', performedReps, plannedReps: plannedTotalReps ?? 0, ratio: 0 };
  const planned = plannedTotalReps ?? 0;
  if (planned === 0) {
    return {
      state: performedReps > 0 ? 'matched' : 'pending',
      performedReps,
      plannedReps: 0,
      ratio: 0,
    };
  }
  const ratio = performedReps / planned;
  if (ratio >= thresholds.matchedMin) return { state: 'matched', performedReps, plannedReps: planned, ratio };
  if (ratio >= thresholds.amberMin) return { state: 'amber', performedReps, plannedReps: planned, ratio };
  return { state: 'red', performedReps, plannedReps: planned, ratio };
}
