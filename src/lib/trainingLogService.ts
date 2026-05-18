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
  ComboMemberEntry,
} from './database.types';
import type { DayLog, LoggedExerciseFull } from './trainingLogModel';

// ─── Aggregate types ──────────────────────────────────────────────────────

export interface PlannedExerciseFull {
  exercise: PlannedExercise;
  exerciseDef: Exercise;
  setLines: PlannedSetLine[];
  /** Component lifts when exercise.is_combo. Empty otherwise. */
  comboMembers: ComboMemberEntry[];
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
 * Resolve the relevant week_plan id for one athlete in one week.
 *
 * Order of preference:
 *   1. An individual plan keyed by athlete_id (created when the coach
 *      syncs a group plan, or when planning that athlete directly).
 *   2. A group plan for any group the athlete belongs to. OWL coaches
 *      routinely write at the group level and only sync occasionally;
 *      athletes still need to see the plan.
 */
export async function resolveAthleteWeekPlanId(
  athleteId: string,
  weekStart: string,
): Promise<{ weekPlanId: string | null; source: 'individual' | 'group' | null }> {
  const { data: indivRow, error: iErr } = await supabase
    .from('week_plans')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .is('group_id', null)
    .maybeSingle();
  if (iErr) throw iErr;
  if (indivRow) return { weekPlanId: (indivRow as { id: string }).id, source: 'individual' };

  const { data: memberships, error: mErr } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('athlete_id', athleteId)
    .is('left_at', null);
  if (mErr) throw mErr;
  const groupIds = ((memberships ?? []) as Array<{ group_id: string }>).map(r => r.group_id);
  if (groupIds.length === 0) return { weekPlanId: null, source: null };

  const { data: groupRow, error: gErr } = await supabase
    .from('week_plans')
    .select('id')
    .in('group_id', groupIds)
    .eq('week_start', weekStart)
    .is('athlete_id', null)
    .limit(1)
    .maybeSingle();
  if (gErr) throw gErr;
  if (groupRow) return { weekPlanId: (groupRow as { id: string }).id, source: 'group' };
  return { weekPlanId: null, source: null };
}

/**
 * The athlete-app's primary data load for a chosen training slot.
 *
 * Returns the planned exercises + set lines for (weekStart, dayIndex) and
 * the existing log session keyed on (athleteId, weekStart, dayIndex). The
 * calendar date is just metadata on the log session — it is decoupled
 * from the slot since v3 (migration 20260405).
 *
 * The plan source falls back to the athlete's group plan if no individual
 * plan exists for that week.
 */
export async function fetchAthleteDay(
  athleteId: string,
  weekStart: string,
  dayIndex: number,
): Promise<AthleteDayData> {
  const { weekPlanId } = await resolveAthleteWeekPlanId(athleteId, weekStart);

  let planned: PlannedExerciseFull[] = [];
  if (weekPlanId) {
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

    // Combo members: each is_combo planned exercise references its
    // component lifts via planned_exercise_combo_members. Without this
    // fetch the athlete only sees the combo's parent name and misses
    // the component list (e.g. "Snatch + OHS" → empty body).
    const comboMembersByPlanned = new Map<string, ComboMemberEntry[]>();
    const comboIds = pes.filter(p => p.is_combo).map(p => p.id);
    if (comboIds.length > 0) {
      const { data: cmRows, error: cmErr } = await supabase
        .from('planned_exercise_combo_members')
        .select('planned_exercise_id, exercise_id, position, exercise:exercise_id(*)')
        .in('planned_exercise_id', comboIds)
        .order('position');
      if (cmErr) throw cmErr;
      type Row = {
        planned_exercise_id: string;
        exercise_id: string;
        position: number;
        exercise: Exercise;
      };
      ((cmRows ?? []) as Row[]).forEach(m => {
        const list = comboMembersByPlanned.get(m.planned_exercise_id) ?? [];
        list.push({ exerciseId: m.exercise_id, exercise: m.exercise, position: m.position });
        comboMembersByPlanned.set(m.planned_exercise_id, list);
      });
    }

    planned = pes.map(pe => ({
      exercise: pe,
      exerciseDef: pe.exercise,
      setLines: setLines.filter(sl => sl.planned_exercise_id === pe.id),
      comboMembers: comboMembersByPlanned.get(pe.id) ?? [],
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
  /** True if the slot is outside the coach's active_days (athlete-added). */
  isBonus: boolean;
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
  /** Where the plan came from. 'group' means coach hasn't synced individually yet. */
  planSource: 'individual' | 'group' | null;
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
  const { weekPlanId, source } = await resolveAthleteWeekPlanId(athleteId, weekStart);
  if (!weekPlanId) {
    return {
      weekStart,
      weekPlanId: null,
      activeDays: [],
      dayLabels: {},
      days: [],
      planSource: null,
    };
  }

  const { data: wpRow, error: wpErr } = await supabase
    .from('week_plans')
    .select('id, active_days, day_labels, day_schedule')
    .eq('id', weekPlanId)
    .maybeSingle();
  if (wpErr) throw wpErr;

  if (!wpRow) {
    return {
      weekStart,
      weekPlanId: null,
      activeDays: [],
      dayLabels: {},
      days: [],
      planSource: null,
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

  // Bonus days: log sessions whose day_index isn't in active_days
  // (athlete added an extra training unit).
  const bonusDays = Array.from(sessionByDay.keys())
    .filter(d => !activeDays.includes(d))
    .sort((a, b) => a - b);
  const allDayIndices = [...activeDays, ...bonusDays];

  const days: WeekDayOverview[] = allDayIndices.map(d => {
    const sess = sessionByDay.get(d);
    const isBonus = !activeDays.includes(d);
    return {
      dayIndex: d,
      label: labels[d]?.trim() || (isBonus ? `Extra ${d - activeDays.length}` : DEFAULT_LABEL(d)),
      weekday: schedule[d]?.weekday ?? null,
      plannedCount: plannedCounts.get(d) ?? 0,
      status: (sess?.status as WeekDayOverview['status']) ?? 'pending',
      sessionDate: sess?.date ?? null,
      hasLog: !!sess,
      isBonus,
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
    planSource: source,
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
    status: 'pending',
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

/**
 * Substitute the actually-performed exercise on a logged exercise row.
 *
 * Athlete UX: "I was supposed to do Snatch but did Power Snatch
 * instead." Updates `exercise_id` on the existing training_log_exercises
 * row while keeping `planned_exercise_id` intact, so coach Log shows
 * Plan vs Did with the substitution visible.
 */
export async function setSubstitutedExercise(
  logExerciseId: string,
  newExerciseId: string,
): Promise<TrainingLogExercise> {
  const { data, error } = await supabase
    .from('training_log_exercises')
    .update({ exercise_id: newExerciseId } as never)
    .eq('id', logExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

/**
 * Delete a log_exercise and (cascade) its sets. Used for athlete
 * "I added this by mistake" and coach manual cleanup.
 */
export async function deleteLogExercise(logExerciseId: string): Promise<void> {
  // Delete sets first in case there's no FK cascade.
  const { error: sErr } = await supabase
    .from('training_log_sets')
    .delete()
    .eq('log_exercise_id', logExerciseId);
  if (sErr) throw sErr;
  const { error } = await supabase
    .from('training_log_exercises')
    .delete()
    .eq('id', logExerciseId);
  if (error) throw error;
}

/**
 * Delete an entire training session (and cascade-clean its exercises +
 * sets + messages). Used for "I added this bonus day by mistake".
 */
export async function deleteSession(sessionId: string): Promise<void> {
  // Clean dependent rows first.
  const { data: exRows } = await supabase
    .from('training_log_exercises')
    .select('id')
    .eq('session_id', sessionId);
  const exIds = ((exRows ?? []) as Array<{ id: string }>).map(e => e.id);
  if (exIds.length > 0) {
    await supabase.from('training_log_sets').delete().in('log_exercise_id', exIds);
    await supabase.from('training_log_exercises').delete().in('id', exIds);
  }
  await supabase.from('training_log_messages').delete().eq('session_id', sessionId);
  const { error } = await supabase
    .from('training_log_sessions')
    .delete()
    .eq('id', sessionId);
  if (error) throw error;
}

/**
 * Fetch all messages for one session, sorted oldest-first.
 * Convenience read for athlete + coach comment threads.
 */
export async function fetchSessionMessages(sessionId: string): Promise<TrainingLogMessage[]> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TrainingLogMessage[];
}

interface AddOffPlanExerciseArgs {
  sessionId: string;
  exerciseId: string;
  /** Position to assign in the session. Defaults to last+1 if omitted. */
  position?: number;
}

/**
 * Create a log_exercise that is NOT linked to a planned_exercise.
 * Used by the athlete app when they did something the coach didn't
 * write into the plan. Status starts 'in_progress' so it shows up in
 * coach Log as "Added by athlete".
 */
export async function addOffPlanLogExercise(
  args: AddOffPlanExerciseArgs,
): Promise<TrainingLogExercise> {
  let position = args.position;
  if (position == null) {
    const { data: existing, error: pErr } = await supabase
      .from('training_log_exercises')
      .select('position')
      .eq('session_id', args.sessionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pErr) throw pErr;
    position = ((existing as { position: number } | null)?.position ?? 0) + 1;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const insertRow: any = {
    session_id: args.sessionId,
    planned_exercise_id: null,
    exercise_id: args.exerciseId,
    position,
    performed_raw: '',
    performed_notes: '',
    status: 'pending',
    started_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('training_log_exercises')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

/**
 * Create a bonus (athlete-added) training session for one week.
 *
 * Inserts a training_log_sessions row with day_index = max(existing
 * active_days, existing session day_indices) + 1, so it's outside the
 * coach's planned slots but still uniquely keyed in the same week.
 * Returns the new session row. Use the WeekOverview from the caller
 * to compute the next day_index.
 */
export async function createBonusSession(args: {
  athleteId: string;
  ownerId: string;
  weekStart: string;
  dayIndex: number;
  date: string;
}): Promise<TrainingLogSession> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const insertRow: any = {
    owner_id: args.ownerId,
    athlete_id: args.athleteId,
    date: args.date,
    week_start: args.weekStart,
    day_index: args.dayIndex,
    session_notes: '',
    status: 'pending',
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

/**
 * Patch one entry in week_plans.day_labels for an athlete's week.
 * Used by athlete add-bonus-day flow so the coach's plan reflects the
 * athlete-given name. Resolves the week_plan via resolveAthleteWeekPlanId
 * (individual first, else group plan).
 *
 * If no week_plan exists yet, the label is silently dropped — the bonus
 * session row still has its day_index, just without a label, falling
 * back to the auto-label.
 */
export async function setAthleteDayLabel(args: {
  athleteId: string;
  weekStart: string;
  dayIndex: number;
  label: string;
}): Promise<void> {
  const { weekPlanId } = await resolveAthleteWeekPlanId(args.athleteId, args.weekStart);
  if (!weekPlanId) return;

  const { data: existing, error: fErr } = await supabase
    .from('week_plans')
    .select('day_labels')
    .eq('id', weekPlanId)
    .maybeSingle();
  if (fErr) throw fErr;

  const labels = ((existing as { day_labels: Record<number, string> | null } | null)?.day_labels) ?? {};
  const nextLabels = { ...labels, [args.dayIndex]: args.label };
  const { error } = await supabase
    .from('week_plans')
    .update({ day_labels: nextLabels } as never)
    .eq('id', weekPlanId);
  if (error) throw error;
}

/**
 * Lightweight exercise-search for the athlete picker.
 * Filters by name (case-insensitive contains).
 */
export async function searchExercisesByName(
  query: string,
  limit = 20,
): Promise<Array<{ id: string; name: string; color: string | null; category: string | null }>> {
  const q = query.trim();
  let qb = supabase.from('exercises').select('id, name, color, category').limit(limit);
  if (q !== '') qb = qb.ilike('name', `%${q}%`);
  qb = qb.order('name');
  const { data, error } = await qb;
  if (error) throw error;
  return (data ?? []) as Array<{
    id: string;
    name: string;
    color: string | null;
    category: string | null;
  }>;
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

// ─── Profile-screen reads ─────────────────────────────────────────────────

export interface BodyweightPoint {
  date: string;
  weightKg: number;
}

/**
 * Bodyweight history for the profile chart. Reads from
 * training_log_sessions.bodyweight_kg — the source of truth chosen
 * during P3. Sorted oldest first for chart-friendly consumption.
 */
export async function fetchBodyweightHistory(
  athleteId: string,
): Promise<BodyweightPoint[]> {
  const { data, error } = await supabase
    .from('training_log_sessions')
    .select('date, bodyweight_kg')
    .eq('athlete_id', athleteId)
    .not('bodyweight_kg', 'is', null)
    .order('date', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as Array<{ date: string; bodyweight_kg: number }>).map(s => ({
    date: s.date,
    weightKg: s.bodyweight_kg,
  }));
}

export interface AthletePRRow {
  exerciseId: string;
  exerciseName: string;
  prValueKg: number | null;
  prDate: string | null;
}

/**
 * PR table for the profile screen. Sorted by value descending so the
 * heaviest lifts top the list.
 */
export async function fetchAthletePRs(athleteId: string): Promise<AthletePRRow[]> {
  const { data, error } = await supabase
    .from('athlete_prs')
    .select('exercise_id, pr_value_kg, pr_date, exercise:exercise_id(name)')
    .eq('athlete_id', athleteId)
    .order('pr_value_kg', { ascending: false });
  if (error) throw error;
  return (
    (data ?? []) as Array<{
      exercise_id: string;
      pr_value_kg: number | null;
      pr_date: string | null;
      exercise: { name: string } | null;
    }>
  )
    .filter(r => r.pr_value_kg != null)
    .map(r => ({
      exerciseId: r.exercise_id,
      exerciseName: r.exercise?.name ?? '(unknown)',
      prValueKg: r.pr_value_kg,
      prDate: r.pr_date,
    }));
}
