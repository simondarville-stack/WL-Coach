/**
 * trainingLogService — typed reads/writes for the Training Log.
 *
 * All planner Log-mode and athlete-app data access goes through this module.
 * Components MUST NOT call supabase directly.
 */
import { supabase } from './supabase';
import type {
  TrainingLogSession,
  TrainingLogExercise,
  TrainingLogSet,
  TrainingLogMessage,
  Exercise,
  PlannedExercise,
  PlannedSetLine,
} from './database.types';
import type { DayLog, LoggedExerciseFull } from './trainingLogModel';

// ─── Aggregate types ──────────────────────────────────────────────────────

export interface PlannedExerciseFull {
  exercise: PlannedExercise;
  exerciseDef: Exercise;
  setLines: PlannedSetLine[];
}

export interface AthleteDayData {
  weekStart: string;
  dayIndex: number;
  planned: PlannedExerciseFull[];
  log: DayLog | null;
}

// ─── Reads ────────────────────────────────────────────────────────────────

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
    const entry: LoggedExerciseFull = { log: ex, sets: exSets, exercise: ex.exercise };
    day.exercises.push(entry);
  }
  Object.values(out).forEach(d => d.exercises.sort((a, b) => a.log.position - b.log.position));
  return out;
}

export async function fetchSessionForSlot(
  athleteId: string,
  weekStart: string,
  dayIndex: number,
): Promise<DayLog | null> {
  const { data: sessionRow, error: sErr } = await supabase
    .from('training_log_sessions')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .eq('day_index', dayIndex)
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
      sets: sets.filter(s => s.log_exercise_id === ex.id).sort((a, b) => a.set_number - b.set_number),
    })),
    messages: (msgRows ?? []) as TrainingLogMessage[],
  };
}

/**
 * The athlete-app's primary data load for a chosen training slot.
 *
 * Returns the planned exercises + set lines for (weekStart, dayIndex) and
 * the existing log session keyed on (athleteId, weekStart, dayIndex). The
 * calendar date is just metadata on the log session — it is decoupled
 * from the slot since v3 (migration 20260405).
 */
export async function fetchAthleteDay(
  athleteId: string,
  weekStart: string,
  dayIndex: number,
): Promise<AthleteDayData> {
  const { data: weekPlanRow, error: wpErr } = await supabase
    .from('week_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (wpErr) throw wpErr;

  let planned: PlannedExerciseFull[] = [];
  if (weekPlanRow) {
    const weekPlanId = (weekPlanRow as { id: string }).id;
    const { data: peRows, error: peErr } = await supabase
      .from('planned_exercises')
      .select('*, exercise:exercise_id(*)')
      .eq('weekplan_id', weekPlanId)
      .eq('day_index', dayIndex)
      .order('position');
    if (peErr) throw peErr;
    const pes = (peRows ?? []) as Array<PlannedExercise & { exercise: Exercise }>;
    const peIds = pes.map(p => p.id);
    let setLines: PlannedSetLine[] = [];
    if (peIds.length > 0) {
      const { data: slRows, error: slErr } = await supabase
        .from('planned_set_lines')
        .select('*')
        .in('planned_exercise_id', peIds)
        .order('position');
      if (slErr) throw slErr;
      setLines = (slRows ?? []) as PlannedSetLine[];
    }
    planned = pes.map(pe => ({
      exercise: pe,
      exerciseDef: pe.exercise,
      setLines: setLines.filter(sl => sl.planned_exercise_id === pe.id),
    }));
  }

  const log = await fetchSessionForSlot(athleteId, weekStart, dayIndex);

  return { weekStart, dayIndex, planned, log };
}

// ─── Week overview (athlete day-picker) ───────────────────────────────────

export interface WeekDayOverview {
  dayIndex: number;
  /** Resolved label from day_labels; falls back to "Day N". */
  label: string;
  /** Planned weekday (1 = Mon, …, 7 = Sun) from day_schedule, or null. */
  weekday: number | null;
  /** Number of planned exercises in this slot. */
  plannedCount: number;
  /** Session status, or 'pending' if no log row exists yet. */
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  /** Calendar date on the log row, if any. */
  sessionDate: string | null;
  /** Whether a log session exists for this slot. */
  hasLog: boolean;
}

export interface WeekOverview {
  weekStart: string;
  weekPlanId: string | null;
  /** Slots the coach activated; sorted ascending. */
  activeDays: number[];
  /** Day index → resolved label (for callers that want raw labels). */
  dayLabels: Record<number, string>;
  /** Pre-built overview rows in activeDays order. */
  days: WeekDayOverview[];
}

const DEFAULT_LABEL = (i: number) => `Day ${i}`;

/**
 * Single-shot load for the athlete day picker: which planned slots exist
 * in this week, what they're called, and whether each has been logged.
 */
export async function fetchWeekOverview(
  athleteId: string,
  weekStart: string,
): Promise<WeekOverview> {
  const { data: wpRow, error: wpErr } = await supabase
    .from('week_plans')
    .select('id, active_days, day_labels, day_schedule')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (wpErr) throw wpErr;

  if (!wpRow) {
    return {
      weekStart,
      weekPlanId: null,
      activeDays: [],
      dayLabels: {},
      days: [],
    };
  }

  const wp = wpRow as {
    id: string;
    active_days: number[];
    day_labels: Record<number, string> | null;
    day_schedule: Record<number, { weekday: number; time: string | null }> | null;
  };
  const activeDays = (wp.active_days ?? []).slice().sort((a, b) => a - b);
  const labels = wp.day_labels ?? {};
  const schedule = wp.day_schedule ?? {};

  // Planned counts per day
  const { data: peRows, error: peErr } = await supabase
    .from('planned_exercises')
    .select('day_index')
    .eq('weekplan_id', wp.id);
  if (peErr) throw peErr;
  const plannedCounts = new Map<number, number>();
  ((peRows ?? []) as Array<{ day_index: number }>).forEach(r => {
    plannedCounts.set(r.day_index, (plannedCounts.get(r.day_index) ?? 0) + 1);
  });

  // Existing log sessions for the week
  const { data: sessionRows, error: sErr } = await supabase
    .from('training_log_sessions')
    .select('day_index, status, date')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart);
  if (sErr) throw sErr;
  const sessionByDay = new Map<number, { status: string; date: string }>();
  ((sessionRows ?? []) as Array<{ day_index: number; status: string; date: string }>).forEach(
    r => sessionByDay.set(r.day_index, { status: r.status, date: r.date }),
  );

  const days: WeekDayOverview[] = activeDays.map(d => {
    const sess = sessionByDay.get(d);
    return {
      dayIndex: d,
      label: labels[d]?.trim() || DEFAULT_LABEL(d),
      weekday: schedule[d]?.weekday ?? null,
      plannedCount: plannedCounts.get(d) ?? 0,
      status: (sess?.status as WeekDayOverview['status']) ?? 'pending',
      sessionDate: sess?.date ?? null,
      hasLog: !!sess,
    };
  });

  return {
    weekStart,
    weekPlanId: wp.id,
    activeDays,
    dayLabels: Object.fromEntries(
      activeDays.map(d => [d, labels[d]?.trim() || DEFAULT_LABEL(d)]),
    ),
    days,
  };
}

// ─── Writes ───────────────────────────────────────────────────────────────

interface EnsureSessionArgs {
  athleteId: string;
  ownerId: string;
  /** Calendar date the athlete is performing this session on. */
  date: string;
  weekStart: string;
  dayIndex: number;
}

/**
 * Find or create the session row for (athlete, weekStart, dayIndex).
 *
 * Note: lookup is by slot, NOT by date. The DB unique constraint is
 * (athlete_id, week_start, day_index) — see migration 20260405. The
 * `date` argument is only used when inserting a fresh row.
 */
export async function ensureSession(args: EnsureSessionArgs): Promise<TrainingLogSession> {
  const { data: existing, error: fErr } = await supabase
    .from('training_log_sessions')
    .select('*')
    .eq('athlete_id', args.athleteId)
    .eq('week_start', args.weekStart)
    .eq('day_index', args.dayIndex)
    .maybeSingle();
  if (fErr) throw fErr;
  if (existing) return existing as TrainingLogSession;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase generated types are stale; matches the cast convention used elsewhere in this codebase.
  const insertRow: any = {
    owner_id: args.ownerId,
    athlete_id: args.athleteId,
    date: args.date,
    week_start: args.weekStart,
    day_index: args.dayIndex,
    session_notes: '',
    status: 'in_progress',
    started_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('training_log_sessions')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogSession;
}

export type SessionPatch = Partial<
  Pick<
    TrainingLogSession,
    | 'date'
    | 'session_notes'
    | 'status'
    | 'raw_sleep'
    | 'raw_physical'
    | 'raw_mood'
    | 'raw_nutrition'
    | 'raw_total'
    | 'raw_guidance'
    | 'session_rpe'
    | 'bodyweight_kg'
    | 'duration_minutes'
    | 'started_at'
    | 'completed_at'
  >
>;

export async function updateSession(
  sessionId: string,
  patch: SessionPatch,
): Promise<TrainingLogSession> {
  const { data, error } = await supabase
    .from('training_log_sessions')
    .update(patch as never)
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogSession;
}

interface EnsureLogExerciseArgs {
  sessionId: string;
  plannedExerciseId: string;
  exerciseId: string;
  position: number;
}

export async function ensureLogExercise(
  args: EnsureLogExerciseArgs,
): Promise<TrainingLogExercise> {
  const { data: existing, error: fErr } = await supabase
    .from('training_log_exercises')
    .select('*')
    .eq('session_id', args.sessionId)
    .eq('planned_exercise_id', args.plannedExerciseId)
    .maybeSingle();
  if (fErr) throw fErr;
  if (existing) return existing as TrainingLogExercise;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const insertRow: any = {
    session_id: args.sessionId,
    planned_exercise_id: args.plannedExerciseId,
    exercise_id: args.exerciseId,
    position: args.position,
    performed_raw: '',
    performed_notes: '',
    status: 'pending',
  };
  const { data, error } = await supabase
    .from('training_log_exercises')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

export type LogExercisePatch = Partial<
  Pick<
    TrainingLogExercise,
    'performed_raw' | 'performed_notes' | 'status' | 'technique_rating' | 'started_at' | 'completed_at'
  >
>;

export async function updateLogExercise(
  logExerciseId: string,
  patch: LogExercisePatch,
): Promise<TrainingLogExercise> {
  const { data, error } = await supabase
    .from('training_log_exercises')
    .update(patch as never)
    .eq('id', logExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

export interface SetPatch {
  logExerciseId: string;
  setNumber: number;
  plannedLoad?: number | null;
  plannedReps?: number | null;
  performedLoad?: number | null;
  performedReps?: number | null;
  rpe?: number | null;
  status?: 'pending' | 'completed' | 'skipped' | 'failed';
  notes?: string | null;
}

/**
 * Upsert one logged set. Finds (log_exercise_id, set_number) and updates
 * if it exists, otherwise inserts. No reliance on a DB unique constraint.
 */
export async function upsertLoggedSet(patch: SetPatch): Promise<TrainingLogSet> {
  const { data: existing, error: fErr } = await supabase
    .from('training_log_sets')
    .select('*')
    .eq('log_exercise_id', patch.logExerciseId)
    .eq('set_number', patch.setNumber)
    .maybeSingle();
  if (fErr) throw fErr;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const row: any = {
    log_exercise_id: patch.logExerciseId,
    set_number: patch.setNumber,
    planned_load: patch.plannedLoad ?? null,
    planned_reps: patch.plannedReps ?? null,
    performed_load: patch.performedLoad ?? null,
    performed_reps: patch.performedReps ?? null,
    rpe: patch.rpe ?? null,
    status: patch.status ?? 'pending',
    notes: patch.notes ?? null,
  };

  if (existing) {
    const { data, error } = await supabase
      .from('training_log_sets')
      .update(row as never)
      .eq('id', (existing as TrainingLogSet).id)
      .select()
      .single();
    if (error) throw error;
    return data as TrainingLogSet;
  }

  const { data, error } = await supabase
    .from('training_log_sets')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogSet;
}

export async function deleteLoggedSet(setId: string): Promise<void> {
  const { error } = await supabase.from('training_log_sets').delete().eq('id', setId);
  if (error) throw error;
}

export interface AddCommentArgs {
  sessionId: string;
  exerciseId?: string | null;
  message: string;
  senderType: 'athlete' | 'coach';
}

export async function addComment(args: AddCommentArgs): Promise<TrainingLogMessage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const insertRow: any = {
    session_id: args.sessionId,
    exercise_id: args.exerciseId ?? null,
    message: args.message,
    sender_type: args.senderType,
  };
  const { data, error } = await supabase
    .from('training_log_messages')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogMessage;
}
