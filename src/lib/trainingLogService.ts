/**
 * trainingLogService — typed reads/writes for the Training Log.
 *
 * All planner Log-mode and athlete-app data access goes through this module.
 * Components MUST NOT call supabase directly. Writes return the updated row
 * for optimistic UI patterns.
 *
 * Status: P1 — reads only. Writes (logSet, upsertSession, addComment) land
 * in P3/P4.
 */
import { supabase } from './supabase';
import type {
  TrainingLogSession,
  TrainingLogExercise,
  TrainingLogSet,
  TrainingLogMessage,
  Exercise,
} from './database.types';
import type { DayLog, LoggedExerciseFull } from './trainingLogModel';

// ─── Reads ────────────────────────────────────────────────────────────────

/**
 * Fetch all log data for one athlete in one week, grouped by day_index.
 * Returns an empty object if the athlete has no sessions for that week
 * (i.e. nothing has been logged yet).
 */
export async function fetchWeekLog(
  athleteId: string,
  weekStart: string,
): Promise<Record<number, DayLog>> {
  const { data: sessionRows, error: sErr } = await supabase
    .from('training_log_sessions')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart);
  if (sErr) throw sErr;

  const sessions = (sessionRows ?? []) as TrainingLogSession[];
  if (sessions.length === 0) return {};

  const sessionIds = sessions.map(s => s.id);

  const { data: exRows, error: exErr } = await supabase
    .from('training_log_exercises')
    .select('*, exercise:exercises(*)')
    .in('session_id', sessionIds);
  if (exErr) throw exErr;
  const exercises = (exRows ?? []) as Array<TrainingLogExercise & { exercise: Exercise | null }>;
  const exIds = exercises.map(e => e.id);

  let sets: TrainingLogSet[] = [];
  if (exIds.length > 0) {
    const { data: setRows, error: setErr } = await supabase
      .from('training_log_sets')
      .select('*')
      .in('log_exercise_id', exIds)
      .order('set_number', { ascending: true });
    if (setErr) throw setErr;
    sets = (setRows ?? []) as TrainingLogSet[];
  }

  const { data: msgRows, error: msgErr } = await supabase
    .from('training_log_messages')
    .select('*')
    .in('session_id', sessionIds)
    .order('created_at', { ascending: true });
  if (msgErr) throw msgErr;
  const messages = (msgRows ?? []) as TrainingLogMessage[];

  // Group by day_index
  const out: Record<number, DayLog> = {};
  for (const s of sessions) {
    out[s.day_index] = {
      date: s.date,
      dayIndex: s.day_index,
      session: s,
      exercises: [],
      messages: messages.filter(m => m.session_id === s.id),
    };
  }

  for (const ex of exercises) {
    const session = sessions.find(s => s.id === ex.session_id);
    if (!session) continue;
    const day = out[session.day_index];
    if (!day) continue;
    const exSets = sets
      .filter(s => s.log_exercise_id === ex.id)
      .sort((a, b) => a.set_number - b.set_number);
    const entry: LoggedExerciseFull = {
      log: ex,
      sets: exSets,
      exercise: ex.exercise,
    };
    day.exercises.push(entry);
  }

  Object.values(out).forEach(d => d.exercises.sort((a, b) => a.log.position - b.log.position));
  return out;
}

/**
 * Fetch one day's session with exercises and sets. Used by the athlete app.
 */
export async function fetchSessionForDay(
  athleteId: string,
  date: string,
): Promise<DayLog | null> {
  const { data: sessionRow, error: sErr } = await supabase
    .from('training_log_sessions')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('date', date)
    .maybeSingle();
  if (sErr) throw sErr;
  if (!sessionRow) return null;
  const session = sessionRow as TrainingLogSession;

  const { data: exRows, error: exErr } = await supabase
    .from('training_log_exercises')
    .select('*, exercise:exercises(*)')
    .eq('session_id', session.id)
    .order('position', { ascending: true });
  if (exErr) throw exErr;
  const exercises = (exRows ?? []) as Array<TrainingLogExercise & { exercise: Exercise | null }>;
  const exIds = exercises.map(e => e.id);

  let sets: TrainingLogSet[] = [];
  if (exIds.length > 0) {
    const { data: setRows, error: setErr } = await supabase
      .from('training_log_sets')
      .select('*')
      .in('log_exercise_id', exIds)
      .order('set_number', { ascending: true });
    if (setErr) throw setErr;
    sets = (setRows ?? []) as TrainingLogSet[];
  }

  const { data: msgRows, error: msgErr } = await supabase
    .from('training_log_messages')
    .select('*')
    .eq('session_id', session.id)
    .order('created_at', { ascending: true });
  if (msgErr) throw msgErr;

  return {
    date: session.date,
    dayIndex: session.day_index,
    session,
    exercises: exercises.map(ex => ({
      log: ex,
      exercise: ex.exercise,
      sets: sets.filter(s => s.log_exercise_id === ex.id),
    })),
    messages: (msgRows ?? []) as TrainingLogMessage[],
  };
}

// ─── Writes — stubs for P3/P4 ─────────────────────────────────────────────

// Intentionally not implemented yet. Callers will get a clean error so we
// notice if any P2 code tries to write through.
export async function upsertSession(): Promise<never> {
  throw new Error('trainingLogService.upsertSession: not implemented until P3');
}
export async function logSet(): Promise<never> {
  throw new Error('trainingLogService.logSet: not implemented until P3');
}
export async function addComment(): Promise<never> {
  throw new Error('trainingLogService.addComment: not implemented until P4');
}
