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
  ExerciseStub,
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
  /** Full Exercise, or an ExerciseStub when only id/name/color are known
   *  (e.g. immediately after addOffPlanLogExercise before a full reload),
   *  or null if the underlying exercise was deleted. (E-05 / UF-32) */
  exercise: Exercise | ExerciseStub | null;
}

export interface DayLog {
  date: string;
  dayIndex: number;
  session: TrainingLogSession | null;
  exercises: LoggedExerciseFull[];
  messages: TrainingLogMessage[];
}

// ─── "Done" state ─────────────────────────────────────────────────────────

/**
 * Canonical "is this exercise done?" predicate. (UF-01 / UF-02)
 *
 * An exercise is considered done when:
 *   1. Its `status` column is already `'completed'` (explicit mark or Log-as-prescribed), OR
 *   2. All planned sets have a terminal status (completed or skipped),
 *      covering the full planned count — auto-promotion trigger.
 *
 * Free-text and GPP exercises have no set rows, so the second condition
 * never fires for them; they rely exclusively on path 1 (explicit "Mark complete").
 *
 * @param le - the logged exercise to evaluate, or null (= not logged → not done).
 * @param plannedSetCount - how many sets were planned (used for auto-promotion
 *   check). Pass null when unknown or for free-text/GPP exercises.
 */
export function isExerciseDone(
  le: LoggedExerciseFull | null,
  plannedSetCount: number | null = null,
): boolean {
  if (!le) return false;
  if (le.log.status === 'completed') return true;
  if (le.sets.length === 0) return false;
  const terminal = le.sets.filter(s => s.status === 'completed' || s.status === 'skipped');
  const count = plannedSetCount ?? le.sets.length;
  return count > 0 && terminal.length >= count;
}

/**
 * Whether a day's session represents real training, independent of the
 * explicit "Finish session" action. (COACH-REVIEW-5)
 *
 * Sessions are created `pending` and only promoted to `completed` when the
 * athlete taps "Finish session" — but exercises auto-promote as they're
 * logged. So an athlete can complete every exercise and close the app without
 * the session ever reaching `completed`, making the coach's Sessions stat and
 * Days-trained dots under-report a fully-trained day.
 *
 * A day counts as trained when the session is explicitly completed OR at
 * least one exercise is done. Keeps the explicit `completed` state meaningful
 * while not letting it be the sole truth for compliance.
 */
export function hasLoggedWork(log: DayLog | null | undefined): boolean {
  if (!log) return false;
  if (log.session?.status === 'completed') return true;
  return log.exercises.some(le => isExerciseDone(le));
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

// ─── RAW score: Eleiko Readiness and Wellbeing model ───────────────────────

/**
 * RAW = Readiness and Wellbeing scoring system (Eleiko).
 *
 * Four pillars (Sleep, Physical, Mood, Nutrition), each rated 1–3, sum
 * 4–12. Three guidance bands map the total to a programme adjustment.
 * Spec: https://www.eleiko.com — Readiness and Wellbeing (RAW) Scoring
 * System. The four-pillar pillar labels and rating text below are
 * verbatim from the Eleiko reference card.
 *
 * Pillar keys match the existing nullable columns on
 * training_log_sessions (raw_sleep / raw_physical / raw_mood /
 * raw_nutrition) — no migration needed.
 */
export interface RawRating {
  score: 1 | 2 | 3;
  /** Pillar-specific description shown next to the score chip. */
  description: string;
}

export interface RawAxis {
  /** DB column on training_log_sessions (raw_<key>). */
  key: 'sleep' | 'physical' | 'mood' | 'nutrition';
  label: string;
  ratings: [RawRating, RawRating, RawRating];
}

export const ELEIKO_RAW_AXES: RawAxis[] = [
  {
    key: 'sleep',
    label: 'Sleep',
    ratings: [
      { score: 1, description: '< 6 hours; not feel well rested' },
      { score: 2, description: 'Do not feel well rested regardless of amount of sleep' },
      { score: 3, description: '8+ hours; feel well rested' },
    ],
  },
  {
    key: 'physical',
    label: 'Physical',
    ratings: [
      { score: 1, description: 'Pain, tightness, fatigue (several symptoms)' },
      { score: 2, description: 'Pain, tightness, OR fatigue (few symptoms)' },
      { score: 3, description: 'No issues' },
    ],
  },
  {
    key: 'mood',
    label: 'Mood',
    ratings: [
      { score: 1, description: 'Agitated / anxious' },
      { score: 2, description: 'Neutral' },
      { score: 3, description: 'Vibrant / ready' },
    ],
  },
  {
    key: 'nutrition',
    label: 'Nutrition',
    ratings: [
      { score: 1, description: 'Poor quality of food and poor hydration' },
      { score: 2, description: 'Fair quality of food and fair hydration' },
      { score: 3, description: 'Good quality of food and good hydration' },
    ],
  },
];

export type RawBand = 'green' | 'amber' | 'red';

export interface RawGuidance {
  band: RawBand;
  /** Short status word for the chip header. */
  label: string;
  /** One-line headline summarising the adjustment. */
  headline: string;
  /** Bullet recommendations from the Eleiko framework. */
  bullets: string[];
}

interface RawGuidanceBand extends RawGuidance {
  min: number;
  max: number;
}

/**
 * Eleiko adjustment bands. Total in [4, 12]. Bullets verbatim from
 * the "Interpreting Your RAW Score" reference card.
 */
export const ELEIKO_RAW_BANDS: RawGuidanceBand[] = [
  {
    min: 10, max: 12,
    band: 'green', label: 'Train as planned',
    headline: 'You are good to train as hard as you desire within your ability level.',
    bullets: [],
  },
  {
    min: 7, max: 9,
    band: 'amber', label: 'Reduce volume 15–20%',
    headline: 'Reduce total volume by 15–20% through any combination of the following:',
    bullets: [
      'Reduce the overall session RPE (effort) by 1',
      'Reduce sets by 1 per lift',
      'Reduce reps by 1–2 per lift',
      'Reduce session length by 15–20%',
      'Depending on session goal, increase rest by 30± sec',
    ],
  },
  {
    min: 4, max: 6,
    band: 'red', label: 'Reduce volume 25–30%',
    headline: 'Reduce total volume by 25–30% through any combination of the following:',
    bullets: [
      'Reduce the overall session RPE (effort) by 2',
      'Reduce sets by 1–2 per lift',
      'Reduce reps by 2–4 per lift',
      'Reduce session length by 25–30%',
      'Depending on session goal, increase rest by 30± sec',
    ],
  },
];

export function getRawGuidance(total: number | null): RawGuidance | null {
  if (total == null) return null;
  return ELEIKO_RAW_BANDS.find(b => total >= b.min && total <= b.max) ?? null;
}

export function rawAxisRange(): { min: number; max: number } {
  return { min: ELEIKO_RAW_AXES.length * 1, max: ELEIKO_RAW_AXES.length * 3 };
}

// ─── Shared input parsing ────────────────────────────────────────────────────

/**
 * Parse a numeric input string, accepting both period and comma as decimal
 * separators. Returns null for empty or non-numeric input.
 * Extracted from SetEntryRow and CoachSetEditModal (E-08 / UF-27).
 */
export function parseNumericInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse a reps input that may carry combo notation ("2+2+2" → 6). Each
 * "+"-delimited part must be a number; the result is the sum. Falls back
 * to parseNumericInput for plain numeric input. Returns null when the
 * input is empty or any part fails to parse.
 *
 * Combo prescriptions like "80×2+1×3" save their per-cluster rep tuple as
 * reps_text ("2+1"), and the athlete sees that as the placeholder. When
 * the athlete echoes it back ("2+2+2"), naive parseFloat silently drops
 * everything after the first digit. Summing the parts preserves their
 * intent in performed_reps.
 */
export function parseRepsInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!trimmed.includes('+')) return parseNumericInput(trimmed);
  const parts = trimmed.split('+').map(p => parseNumericInput(p));
  if (parts.some(p => p == null)) return null;
  return (parts as number[]).reduce((a, b) => a + b, 0);
}

// ─── Delta colour helpers ────────────────────────────────────────────────────

/**
 * Map a DeltaState to the Tailwind border-left colour class used in
 * LogExerciseRow and SessionPreview exercise rows.
 * Extracted from three inline ternary chains (E-10 / UF-28).
 */
export function getDeltaBorderClass(state: DeltaState): string {
  switch (state) {
    case 'matched': return 'border-l-emerald-500';
    case 'amber':   return 'border-l-amber-500';
    case 'red':     return 'border-l-red-500';
    case 'pending': return 'border-l-gray-300';
  }
}

/**
 * Map a DeltaState to the Tailwind chip background+text colour classes used
 * in the performed ratio badge (e.g. "87%").
 * Extracted from three inline ternary chains (E-10 / UF-28).
 */
export function getDeltaChipClass(state: DeltaState): string {
  switch (state) {
    case 'matched': return 'bg-emerald-100 text-emerald-800';
    case 'amber':   return 'bg-amber-100 text-amber-800';
    case 'red':     return 'bg-red-100 text-red-800';
    case 'pending': return 'bg-gray-100 text-gray-500';
  }
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
