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

export function maxPerformedLoad(sets: TrainingLogSet[]): number {
  const done = sets.filter(s => s.status === 'completed' && s.performed_load != null);
  if (done.length === 0) return 0;
  return Math.max(...done.map(s => s.performed_load ?? 0));
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
