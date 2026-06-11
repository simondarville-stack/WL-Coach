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
  AthleteMetricDefinition,
  AthleteWeekMetricsConfig,
  CustomMetricEntry,
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
  /** Coach-toggled metric config for this athlete + week. Null if no
   *  config row exists yet — callers should fall back to "RAW + BW on,
   *  VAS off, no custom" so behaviour matches the pre-feature default. */
  metricsConfig: AthleteWeekMetricsConfig | null;
  /** Active custom metric definitions the coach has on this athlete.
   *  May include definitions not enabled this week — UI filters by
   *  metricsConfig.enabled_custom_metric_ids. */
  metricDefinitions: AthleteMetricDefinition[];
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
  const exercises = (exRows ?? []) as unknown as Array<TrainingLogExercise & { exercise: Exercise | null }>;
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
  const exercises = (exRows ?? []) as unknown as Array<TrainingLogExercise & { exercise: Exercise | null }>;
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
 * Athletes a group plan has been synced to for a given week. (COACH-REVIEW-8)
 *
 * When a coach syncs a group week to its athletes, each athlete gets an
 * individual week_plans row whose source_group_plan_id points back at the
 * group plan. GroupLogView uses this to show per-athlete sync state, so the
 * query belongs in the service layer rather than inline in the component.
 *
 * Returns the set of synced athlete ids; empty when no group plan exists.
 */
export async function fetchGroupSyncStatus(
  groupPlanId: string | null | undefined,
  weekStart: string,
): Promise<Set<string>> {
  if (!groupPlanId) return new Set();
  const { data, error } = await supabase
    .from('week_plans')
    .select('athlete_id')
    .eq('source_group_plan_id', groupPlanId)
    .eq('week_start', weekStart)
    .not('athlete_id', 'is', null);
  if (error) throw error;
  return new Set(
    ((data ?? []) as Array<{ athlete_id: string | null }>)
      .map(r => r.athlete_id)
      .filter((id): id is string => id != null),
  );
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
  /** Optional pre-resolved weekPlanId from a previous fetchWeekOverview call.
   *  When provided, the 3-step resolution chain is skipped, saving 2–3 round
   *  trips on mobile. (UF-44 / H4) */
  knownWeekPlanId?: string | null,
): Promise<AthleteDayData> {
  const weekPlanId = knownWeekPlanId !== undefined
    ? knownWeekPlanId
    : (await resolveAthleteWeekPlanId(athleteId, weekStart)).weekPlanId;

  const planned = weekPlanId ? await fetchPlannedDay(weekPlanId, dayIndex) : [];

  const log = await fetchSessionForSlot(athleteId, weekStart, dayIndex);

  // Metric tracking config + definitions. Athlete app shows VAS, custom
  // inputs, etc. based on this; we fetch in parallel and tolerate the
  // tables being empty (no config yet, no definitions yet).
  const [metricsConfig, metricDefinitions] = await Promise.all([
    fetchWeekMetricsConfig(athleteId, weekStart),
    fetchMetricDefinitions(athleteId),
  ]);

  return { weekStart, dayIndex, planned, log, metricsConfig, metricDefinitions };
}

/**
 * Read-only fetch of one day's planned exercises for a given weekPlanId.
 * Shared between the athlete day fetcher (which also pulls log + metrics)
 * and the group viewer (which only needs the planned side). Includes set
 * lines and combo members so the same rendering primitives can consume
 * the result.
 */
export async function fetchPlannedDay(
  weekPlanId: string,
  dayIndex: number,
): Promise<PlannedExerciseFull[]> {
  const { data: peRows, error: peErr } = await supabase
    .from('planned_exercises')
    .select('*, exercise:exercise_id(*)')
    .eq('weekplan_id', weekPlanId)
    .eq('day_index', dayIndex)
    .order('position');
  if (peErr) throw peErr;
  const pes = (peRows ?? []) as unknown as Array<PlannedExercise & { exercise: Exercise }>;
  if (pes.length === 0) return [];

  const peIds = pes.map(p => p.id);
  const { data: slRows, error: slErr } = await supabase
    .from('planned_set_lines')
    .select('*')
    .in('planned_exercise_id', peIds)
    .order('position');
  if (slErr) throw slErr;
  const setLines = (slRows ?? []) as PlannedSetLine[];

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
    ((cmRows ?? []) as unknown as Row[]).forEach(m => {
      const list = comboMembersByPlanned.get(m.planned_exercise_id) ?? [];
      list.push({ exerciseId: m.exercise_id, exercise: m.exercise, position: m.position });
      comboMembersByPlanned.set(m.planned_exercise_id, list);
    });
  }

  return pes.map(pe => ({
    exercise: pe,
    exerciseDef: pe.exercise,
    setLines: setLines.filter(sl => sl.planned_exercise_id === pe.id),
    comboMembers: comboMembersByPlanned.get(pe.id) ?? [],
  }));
}

// ─── Week overview (athlete day-picker) ───────────────────────────────────

export interface WeekDayOverview {
  dayIndex: number;
  /** Resolved label from day_labels; falls back to "Day N". */
  label: string;
  /** Planned weekday (0 = Mon, …, 6 = Sun) from day_schedule, or null.
   *  Convention matches migration 20260405_day_schedule.sql and the coach
   *  planner's WEEKDAY_SHORT array. (Q-13) */
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

/**
 * Fallback slot label when the coach hasn't named a day. (UX-BESTPRACTICE-12)
 *
 * Single source of truth for the unlabeled day name — keyed on the same
 * day_index base as active_days / day_labels — so the week-overview picker,
 * TodayScreen and GroupViewerScreen all agree (they previously diverged
 * between "Day {dayIndex}" and "Day {idx + 1}").
 */
export const defaultSlotLabel = (i: number) => `Day ${i}`;
const DEFAULT_LABEL = defaultSlotLabel;

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
    | 'session_rpe'
    | 'bodyweight_kg'
    | 'duration_minutes'
    | 'started_at'
    | 'completed_at'
    | 'vas_score'
    | 'custom_metrics'
  >
>;

export async function updateSession(
  sessionId: string,
  patch: SessionPatch,
): Promise<TrainingLogSession> {
  const { data, error } = await supabase
    .from('training_log_sessions')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client types lag; safe cast. Remove after running supabase gen types.
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
  // .order().limit(1) instead of .maybeSingle() so that historic
  // duplicate rows (from the pre-queue race condition documented in
  // GppLogCard) don't permanently brick every save with a PGRST116
  // "multiple rows" error. We pick the oldest row by created_at and
  // continue; subsequent edits update that canonical row only.
  const { data: existingRows, error: fErr } = await supabase
    .from('training_log_exercises')
    .select('*')
    .eq('session_id', args.sessionId)
    .eq('planned_exercise_id', args.plannedExerciseId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (fErr) throw fErr;
  const existing = (existingRows ?? [])[0];
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client types lag; safe cast.
    .update(patch as never)
    .eq('id', logExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

/**
 * Mark a planned set as removed by the athlete (the set was in the
 * prescription, but the athlete chose to drop it without logging).
 * Stored as an int[] in training_log_exercises.metadata so the planned
 * lines themselves stay untouched. Idempotent.
 */
export async function removePlannedSet(
  logExerciseId: string,
  setNumber: number,
): Promise<TrainingLogExercise> {
  const { data: row, error: rErr } = await supabase
    .from('training_log_exercises')
    .select('metadata')
    .eq('id', logExerciseId)
    .single();
  if (rErr) throw rErr;
  const current = ((row as { metadata: { removed_set_numbers?: number[] } } | null)?.metadata
    ?.removed_set_numbers ?? []) as number[];
  if (current.includes(setNumber)) {
    const { data: existing, error: eErr } = await supabase
      .from('training_log_exercises')
      .select('*')
      .eq('id', logExerciseId)
      .single();
    if (eErr) throw eErr;
    return existing as TrainingLogExercise;
  }
  const next = [...current, setNumber].sort((a, b) => a - b);
  const { data, error } = await supabase
    .from('training_log_exercises')
    .update({ metadata: { ...((row as { metadata: object } | null)?.metadata ?? {}), removed_set_numbers: next } } as never)
    .eq('id', logExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

/**
 * Persist the athlete-side state of a GPP block (row edits + done
 * flags) on the log_exercise's metadata. Idempotent.
 */
export async function setLogExerciseGppSection(
  logExerciseId: string,
  section: import('./database.types').GppSection,
): Promise<TrainingLogExercise> {
  const { data: row, error: rErr } = await supabase
    .from('training_log_exercises')
    .select('metadata')
    .eq('id', logExerciseId)
    .single();
  if (rErr) throw rErr;
  const current = ((row as { metadata?: Record<string, unknown> } | null)?.metadata ?? {}) as Record<string, unknown>;
  const next = { ...current, gpp: section };
  const { data, error } = await supabase
    .from('training_log_exercises')
    .update({ metadata: next } as never)
    .eq('id', logExerciseId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogExercise;
}

/**
 * Inverse of removePlannedSet — re-introduces a previously dropped
 * planned set (currently unused, but useful for future "undo remove").
 */
export async function restorePlannedSet(
  logExerciseId: string,
  setNumber: number,
): Promise<TrainingLogExercise> {
  const { data: row, error: rErr } = await supabase
    .from('training_log_exercises')
    .select('metadata')
    .eq('id', logExerciseId)
    .single();
  if (rErr) throw rErr;
  const current = ((row as { metadata: { removed_set_numbers?: number[] } } | null)?.metadata
    ?.removed_set_numbers ?? []) as number[];
  const next = current.filter(n => n !== setNumber);
  const { data, error } = await supabase
    .from('training_log_exercises')
    .update({ metadata: { ...((row as { metadata: object } | null)?.metadata ?? {}), removed_set_numbers: next } } as never)
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
  /** Free-text performed value for non-quantified units. Stored in
   *  training_log_sets.performed_text (separate from notes). See UF-43. */
  performedText?: string | null;
  rpe?: number | null;
  status?: 'pending' | 'completed' | 'skipped' | 'failed';
  notes?: string | null;
}

/**
 * Upsert one logged set via INSERT ... ON CONFLICT (log_exercise_id, set_number).
 * Requires migration 20260520000002_add_set_unique_constraint to be applied.
 * Falls back gracefully if the constraint isn't yet present (Supabase upsert
 * semantics: the ON CONFLICT clause must match the constraint column list).
 */
export async function upsertLoggedSet(patch: SetPatch): Promise<TrainingLogSet> {
  const row = {
    log_exercise_id: patch.logExerciseId,
    set_number: patch.setNumber,
    planned_load: patch.plannedLoad ?? null,
    planned_reps: patch.plannedReps ?? null,
    performed_load: patch.performedLoad ?? null,
    performed_reps: patch.performedReps ?? null,
    performed_text: patch.performedText ?? null,
    rpe: patch.rpe ?? null,
    status: patch.status ?? 'pending',
    notes: patch.notes ?? null,
  };

  const { data, error } = await supabase
    .from('training_log_sets')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client types lag; safe cast.
    .upsert(row as any, { onConflict: 'log_exercise_id,set_number' })
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
  /** Active coach id for coach-sent messages; null for athlete sends.
   *  Lets a shared inbox label which coach wrote each bubble — without
   *  it, multi-coach threads collapse to "Coach" with no disambiguation. */
  senderCoachId?: string | null;
}

export async function addComment(args: AddCommentArgs): Promise<TrainingLogMessage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const insertRow: any = {
    session_id: args.sessionId,
    exercise_id: args.exerciseId ?? null,
    message: args.message,
    sender_type: args.senderType,
    sender_coach_id: args.senderType === 'coach' ? args.senderCoachId ?? null : null,
  };
  const { data, error } = await supabase
    .from('training_log_messages')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogMessage;
}

/**
 * Mark all messages in a session (or, when exerciseId is given, for one
 * exercise) as read by the viewer's role. Sets coach_read_at or
 * athlete_read_at to now() on rows where it is currently null and the
 * sender is the other party.
 *
 * Requires migration 20260520000005_add_message_read_tracking to be applied.
 */
export async function markMessagesRead(
  sessionId: string,
  exerciseId: string | null,
  role: 'coach' | 'athlete',
): Promise<void> {
  const column = role === 'coach' ? 'coach_read_at' : 'athlete_read_at';
  const otherSender: 'athlete' | 'coach' = role === 'coach' ? 'athlete' : 'coach';
  const now = new Date().toISOString();
  // Only mark messages from the other party that this viewer hasn't read yet.
  let q = supabase
    .from('training_log_messages')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase client types lag; safe cast.
    .update({ [column]: now } as never)
    .eq('session_id', sessionId)
    .eq('sender_type', otherSender)
    .is(column, null);
  if (exerciseId != null) {
    q = q.eq('exercise_id', exerciseId);
  }
  const { error } = await q;
  if (error) throw error;
}

// ─── Coach inbox ──────────────────────────────────────────────────────────

/** One thread in the coach inbox. Either a session-bound thread
 *  (kind: 'session', sessionId set, performedOn set) or a general
 *  per-athlete thread that is not tied to any one training day
 *  (kind: 'general', sessionId & performedOn null). The list view
 *  renders both shapes side by side. */
export interface InboxThread {
  kind: 'session' | 'general';
  /** Session id for kind='session'; null for kind='general'. */
  sessionId: string | null;
  athleteId: string;
  athleteName: string;
  athletePhotoUrl: string | null;
  /** Session date in ISO yyyy-mm-dd; null for general threads. */
  performedOn: string | null;
  /** Most recent athlete message body — list preview. */
  lastMessage: string;
  /** created_at of the most recent message (athlete or coach), so the
   *  sort matches what a chat app would show. */
  lastActivityAt: string;
  /** Athlete messages where coach_read_at IS NULL. */
  unreadCount: number;
  /** Total athlete-sent messages on this thread (used to disambiguate
   *  empty threads from threads that were already read). */
  athleteMessageCount: number;
}

/** Fetch every athlete-sent message for the active coach, grouped into
 *  threads by session. Unread threads sort first; within a sort group,
 *  most-recently-active threads come first. */
export async function fetchInboxThreads(ownerId: string): Promise<InboxThread[]> {
  // 1. Pull every athlete-sent message owned by this coach. We need the
  //    full set so we can compute unreadCount and pick the latest message
  //    per thread; a per-session top-1 query would force one round-trip
  //    per thread.
  const { data: athleteMsgs, error: amErr } = await supabase
    .from('training_log_messages')
    .select('id, session_id, message, created_at, coach_read_at')
    .eq('owner_id', ownerId)
    .eq('sender_type', 'athlete')
    .order('created_at', { ascending: false });
  if (amErr) throw amErr;
  const rows = (athleteMsgs ?? []) as {
    id: string;
    session_id: string | null;
    message: string;
    created_at: string;
    coach_read_at: string | null;
  }[];
  if (rows.length === 0) return [];

  // Session-bound rows only; general (session_id NULL) athlete messages
  // are aggregated separately below. Without this filter, sessionIds
  // would contain null and PostgREST encodes `.in('id', [null,…])` as
  // the literal string "null", which Postgres rejects with
  // "invalid input syntax for type uuid: \"null\"".
  const sessionRows = rows.filter((r): r is typeof r & { session_id: string } => r.session_id !== null);
  const sessionIds = Array.from(new Set(sessionRows.map(r => r.session_id)));

  // 2. For "last activity", we also need coach messages — a thread the
  //    coach just replied to should bubble up.
  const { data: coachMsgs } = await supabase
    .from('training_log_messages')
    .select('session_id, created_at')
    .in('session_id', sessionIds)
    .eq('sender_type', 'coach')
    .order('created_at', { ascending: false });

  // 3. Session → athlete map. The DB column is `date`; we expose it as
  // `performedOn` on the InboxThread for clarity at the call site.
  const { data: sessions, error: sErr } = await supabase
    .from('training_log_sessions')
    .select('id, athlete_id, date')
    .in('id', sessionIds);
  if (sErr) throw sErr;
  const sessionMap = new Map<string, { athleteId: string; performedOn: string }>();
  (sessions ?? []).forEach((s: { id: string; athlete_id: string; date: string }) => {
    sessionMap.set(s.id, { athleteId: s.athlete_id, performedOn: s.date });
  });

  const athleteIds = Array.from(new Set(Array.from(sessionMap.values()).map(s => s.athleteId)));
  const { data: athletes } = athleteIds.length > 0
    ? await supabase
        .from('athletes')
        .select('id, name, photo_url')
        .in('id', athleteIds)
    : { data: [] };
  const athleteMap = new Map<string, { name: string; photoUrl: string | null }>();
  (athletes ?? []).forEach((a: { id: string; name: string; photo_url: string | null }) => {
    athleteMap.set(a.id, { name: a.name, photoUrl: a.photo_url });
  });

  // Latest coach activity per session.
  const latestCoachAt = new Map<string, string>();
  (coachMsgs ?? []).forEach(m => {
    // session_id is nullable on the row but we filtered out nulls at the
    // query level (.not('session_id', 'is', null)). Coerce explicitly so
    // downstream Map ops keep their string key type.
    if (!m.session_id) return;
    if (!latestCoachAt.has(m.session_id)) latestCoachAt.set(m.session_id, m.created_at);
  });

  // Build threads. rows is already ordered newest-first, so the first
  // athlete message we see per session is the most recent. Iterate the
  // non-null subset so the Map key (and downstream sessionId field) is
  // always a real uuid.
  const threads = new Map<string, InboxThread>();
  for (const r of sessionRows) {
    const sess = sessionMap.get(r.session_id);
    if (!sess) continue; // orphan message — session was deleted
    const athlete = athleteMap.get(sess.athleteId);
    if (!athlete) continue; // orphan — athlete was deleted

    let t = threads.get(r.session_id);
    if (!t) {
      const coachAt = latestCoachAt.get(r.session_id) ?? null;
      const lastActivity = coachAt && coachAt > r.created_at ? coachAt : r.created_at;
      t = {
        kind: 'session',
        sessionId: r.session_id,
        athleteId: sess.athleteId,
        athleteName: athlete.name,
        athletePhotoUrl: athlete.photoUrl,
        performedOn: sess.performedOn,
        lastMessage: r.message,
        lastActivityAt: lastActivity,
        unreadCount: 0,
        athleteMessageCount: 0,
      };
      threads.set(r.session_id, t);
    }
    t.athleteMessageCount += 1;
    if (r.coach_read_at == null) t.unreadCount += 1;
  }

  // 4. General (no-session) threads — one per athlete that has any
  //    general messages. Keyed separately so the coach sees them next
  //    to the session threads.
  const generalThreads = await fetchGeneralThreadsForCoach(ownerId);

  // Sort: unread first, then by lastActivity desc.
  return [...Array.from(threads.values()), ...generalThreads].sort((a, b) => {
    const aUnread = a.unreadCount > 0 ? 1 : 0;
    const bUnread = b.unreadCount > 0 ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
}

/** Aggregate every general (session_id IS NULL) message owned by this
 *  coach into one InboxThread per athlete. Same shape as a session
 *  thread but with kind='general' and sessionId/performedOn null. */
async function fetchGeneralThreadsForCoach(ownerId: string): Promise<InboxThread[]> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('athlete_id, sender_type, message, created_at, coach_read_at')
    .eq('owner_id', ownerId)
    .is('session_id', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as {
    athlete_id: string | null;
    sender_type: 'athlete' | 'coach';
    message: string;
    created_at: string;
    coach_read_at: string | null;
  }[];
  if (rows.length === 0) return [];

  const athleteIds = Array.from(new Set(rows.map(r => r.athlete_id).filter((x): x is string => !!x)));
  if (athleteIds.length === 0) return [];

  const { data: athletes } = await supabase
    .from('athletes')
    .select('id, name, photo_url')
    .in('id', athleteIds);
  const athleteMap = new Map<string, { name: string; photoUrl: string | null }>();
  (athletes ?? []).forEach((a: { id: string; name: string; photo_url: string | null }) => {
    athleteMap.set(a.id, { name: a.name, photoUrl: a.photo_url });
  });

  const byAthlete = new Map<string, InboxThread>();
  for (const r of rows) {
    if (!r.athlete_id) continue;
    const athlete = athleteMap.get(r.athlete_id);
    if (!athlete) continue;
    let t = byAthlete.get(r.athlete_id);
    if (!t) {
      t = {
        kind: 'general',
        sessionId: null,
        athleteId: r.athlete_id,
        athleteName: athlete.name,
        athletePhotoUrl: athlete.photoUrl,
        performedOn: null,
        lastMessage: r.message,
        lastActivityAt: r.created_at,
        unreadCount: 0,
        athleteMessageCount: 0,
      };
      byAthlete.set(r.athlete_id, t);
    } else if (r.created_at > t.lastActivityAt) {
      t.lastActivityAt = r.created_at;
      // Use the latest athlete message as the preview; if the latest
      // overall is a coach message, keep the existing athlete preview.
      if (r.sender_type === 'athlete') t.lastMessage = r.message;
    }
    if (r.sender_type === 'athlete') {
      t.athleteMessageCount += 1;
      if (r.coach_read_at == null) t.unreadCount += 1;
    }
  }
  return Array.from(byAthlete.values());
}

/** Lightweight count for the sidebar badge. Counts distinct threads
 *  (sessions OR per-athlete general threads) with at least one unread
 *  athlete message — matches what the user sees as "unread threads"
 *  rather than "unread messages". */
export async function fetchInboxUnreadCount(ownerId: string): Promise<number> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('session_id, athlete_id')
    .eq('owner_id', ownerId)
    .eq('sender_type', 'athlete')
    .is('coach_read_at', null);
  if (error) throw error;
  const rows = (data ?? []) as { session_id: string | null; athlete_id: string | null }[];
  // A "thread key" is the session id for session-bound messages, or
  // "general:<athleteId>" for general messages — both flavours feed
  // the same badge.
  const keys = new Set<string>();
  for (const r of rows) {
    if (r.session_id) keys.add(r.session_id);
    else if (r.athlete_id) keys.add(`general:${r.athlete_id}`);
  }
  return keys.size;
}

// ─── General (no-session) thread helpers ─────────────────────────────────

/** Every message in the general thread between this coach and athlete,
 *  oldest first (chronological for chat display). */
export async function fetchGeneralThreadMessages(
  athleteId: string,
  ownerId: string,
): Promise<TrainingLogMessage[]> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('athlete_id', athleteId)
    .is('session_id', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as TrainingLogMessage[];
}

export interface SendGeneralMessageArgs {
  athleteId: string;
  ownerId: string;
  message: string;
  senderType: 'athlete' | 'coach';
  /** Active coach id for coach-sent messages; null for athlete sends. */
  senderCoachId?: string | null;
}

/** Insert a general (no-session) message. Both owner_id and athlete_id
 *  are required because no session exists to derive them from. */
export async function sendGeneralMessage(
  args: SendGeneralMessageArgs,
): Promise<TrainingLogMessage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag schema
  const insertRow: any = {
    session_id: null,
    exercise_id: null,
    athlete_id: args.athleteId,
    owner_id: args.ownerId,
    message: args.message,
    sender_type: args.senderType,
    sender_coach_id: args.senderType === 'coach' ? args.senderCoachId ?? null : null,
  };
  const { data, error } = await supabase
    .from('training_log_messages')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogMessage;
}

/** Mark every general message from the other party as read by this role. */
export async function markGeneralThreadRead(
  athleteId: string,
  ownerId: string,
  role: 'coach' | 'athlete',
): Promise<void> {
  const column = role === 'coach' ? 'coach_read_at' : 'athlete_read_at';
  const otherSender: 'athlete' | 'coach' = role === 'coach' ? 'athlete' : 'coach';
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('training_log_messages')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated types lag
    .update({ [column]: now } as never)
    .eq('owner_id', ownerId)
    .eq('athlete_id', athleteId)
    .is('session_id', null)
    .eq('sender_type', otherSender)
    .is(column, null);
  if (error) throw error;
}

/** Lightweight unread count for one athlete's general thread, used by
 *  the athlete-app badge on the Coach tab. */
export async function fetchAthleteGeneralUnreadCount(
  athleteId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('id')
    .eq('athlete_id', athleteId)
    .is('session_id', null)
    .eq('sender_type', 'coach')
    .is('athlete_read_at', null);
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Total unread coach messages for an athlete — counts both general
 * (session_id IS NULL) and session-bound coach comments. Drives the
 * Coach-tab badge on the athlete bottom nav so the athlete is alerted
 * regardless of which inbox surface the coach used.
 */
export async function fetchAthleteInboxUnreadCount(
  athleteId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('id')
    .eq('athlete_id', athleteId)
    .eq('sender_type', 'coach')
    .is('athlete_read_at', null);
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Athlete-facing inbox: one InboxThread row per general conversation +
 * one per session that has any messages. Same shape as the coach inbox
 * so the rendering can be shared. Sorted unread-first then by activity.
 *
 * The athlete sees only their own threads, so we filter by athlete_id.
 * Co-coach activity (shared athletes) appears in the same threads —
 * messages are athlete-scoped, not coach-scoped, so a co-coach's reply
 * shows up here just like the host's.
 */
/**
 * Resolve coach display names for a batch of messages. Looks up unique
 * sender_coach_ids and returns a Map id → name. Used by both inboxes
 * to label coach-sent bubbles in a shared thread; messages without a
 * sender_coach_id (athlete sends, or legacy pre-share-feature rows)
 * are not in the map and the caller falls back to "Coach".
 */
export async function fetchCoachNamesForMessages(
  messages: TrainingLogMessage[],
): Promise<Map<string, string>> {
  const coachIds = Array.from(
    new Set(
      messages
        .map(m => m.sender_coach_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  );
  if (coachIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('id, name')
    .in('id', coachIds);
  if (error || !data) return new Map();
  return new Map(data.map(r => [r.id as string, r.name as string]));
}

export async function fetchAthleteInboxThreads(
  athleteId: string,
): Promise<InboxThread[]> {
  const { data, error } = await supabase
    .from('training_log_messages')
    .select('id, session_id, sender_type, message, created_at, athlete_read_at')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as {
    id: string;
    session_id: string | null;
    sender_type: 'athlete' | 'coach';
    message: string;
    created_at: string;
    athlete_read_at: string | null;
  }[];
  if (rows.length === 0) return [];

  // Session ids we need to hydrate with their performed-on dates.
  const sessionIds = Array.from(
    new Set(rows.map(r => r.session_id).filter((id): id is string => !!id)),
  );
  const sessionMap = new Map<string, string>();
  if (sessionIds.length > 0) {
    const { data: sessions } = await supabase
      .from('training_log_sessions')
      .select('id, date')
      .in('id', sessionIds);
    (sessions ?? []).forEach((s: { id: string; date: string }) => {
      sessionMap.set(s.id, s.date);
    });
  }

  // Look up the athlete row once for name/photo (the InboxThread shape
  // expects these even on the athlete's own inbox view).
  const { data: athleteRow } = await supabase
    .from('athletes')
    .select('name, photo_url')
    .eq('id', athleteId)
    .maybeSingle();
  const athleteName = (athleteRow?.name as string | undefined) ?? '';
  const athletePhotoUrl = (athleteRow?.photo_url as string | null | undefined) ?? null;

  // Build thread map keyed by session id, or 'general' for session-less.
  const threads = new Map<string, InboxThread>();
  for (const r of rows) {
    const key = r.session_id ?? 'general';
    let t = threads.get(key);
    if (!t) {
      const performedOn = r.session_id ? sessionMap.get(r.session_id) ?? null : null;
      // Skip session-bound messages whose session has been deleted.
      if (r.session_id && !performedOn) continue;
      t = {
        kind: r.session_id ? 'session' : 'general',
        sessionId: r.session_id,
        athleteId,
        athleteName,
        athletePhotoUrl,
        performedOn,
        lastMessage: r.message,
        lastActivityAt: r.created_at,
        unreadCount: 0,
        athleteMessageCount: 0,
      };
      threads.set(key, t);
    } else if (r.created_at > t.lastActivityAt) {
      t.lastActivityAt = r.created_at;
      // Preview prefers the most-recent coach message — that's the one
      // the athlete most cares about. Athlete-sent text echoes are less
      // useful as a "what's new" hint.
      if (r.sender_type === 'coach') t.lastMessage = r.message;
    }
    if (r.sender_type === 'athlete') t.athleteMessageCount += 1;
    if (r.sender_type === 'coach' && r.athlete_read_at == null) t.unreadCount += 1;
  }

  return Array.from(threads.values()).sort((a, b) => {
    if ((a.unreadCount > 0) !== (b.unreadCount > 0)) return a.unreadCount > 0 ? -1 : 1;
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  });
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

// ─── Per-week metric tracking config ──────────────────────────────────────────
//
// The coach toggles per-week which inputs the athlete is asked for
// (RAW, BW, VAS, custom). Definitions persist per athlete; the per-week
// row picks which to actually collect this week. See migration
// 20260519000002_add_metric_toggles.sql.

export async function fetchMetricDefinitions(
  athleteId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<AthleteMetricDefinition[]> {
  let q = supabase
    .from('athlete_metric_definitions')
    .select('*')
    .eq('athlete_id', athleteId)
    .order('created_at', { ascending: true });
  if (!opts.includeArchived) q = q.is('archived_at', null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AthleteMetricDefinition[];
}

export async function createMetricDefinition(args: {
  athleteId: string;
  ownerId: string;
  label: string;
  valueType: 'number' | 'text';
  unit: string | null;
}): Promise<AthleteMetricDefinition> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const row: any = {
    athlete_id: args.athleteId,
    owner_id: args.ownerId,
    label: args.label,
    value_type: args.valueType,
    unit: args.unit,
  };
  const { data, error } = await supabase
    .from('athlete_metric_definitions')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as AthleteMetricDefinition;
}

export async function updateMetricDefinition(
  id: string,
  patch: Partial<Pick<AthleteMetricDefinition, 'label' | 'value_type' | 'unit'>>,
): Promise<AthleteMetricDefinition> {
  const { data, error } = await supabase
    .from('athlete_metric_definitions')
    .update(patch as never)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data as AthleteMetricDefinition;
}

export async function archiveMetricDefinition(id: string): Promise<void> {
  const { error } = await supabase
    .from('athlete_metric_definitions')
    .update({ archived_at: new Date().toISOString() } as never)
    .eq('id', id);
  if (error) throw error;
}

export async function fetchWeekMetricsConfig(
  athleteId: string,
  weekStart: string,
): Promise<AthleteWeekMetricsConfig | null> {
  const { data, error } = await supabase
    .from('athlete_week_metrics_config')
    .select('*')
    .eq('athlete_id', athleteId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as AthleteWeekMetricsConfig | null;
}

export async function upsertWeekMetricsConfig(args: {
  athleteId: string;
  ownerId: string;
  weekStart: string;
  trackRaw: boolean;
  trackBodyweight: boolean;
  trackVas: boolean;
  enabledCustomMetricIds: string[];
}): Promise<AthleteWeekMetricsConfig> {
  const existing = await fetchWeekMetricsConfig(args.athleteId, args.weekStart);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stale generated types
  const row: any = {
    athlete_id: args.athleteId,
    owner_id: args.ownerId,
    week_start: args.weekStart,
    track_raw: args.trackRaw,
    track_bodyweight: args.trackBodyweight,
    track_vas: args.trackVas,
    enabled_custom_metric_ids: args.enabledCustomMetricIds,
  };
  if (existing) {
    const { data, error } = await supabase
      .from('athlete_week_metrics_config')
      .update(row as never)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw error;
    return data as AthleteWeekMetricsConfig;
  }
  const { data, error } = await supabase
    .from('athlete_week_metrics_config')
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as AthleteWeekMetricsConfig;
}

/**
 * Update a single custom metric value on a session. Pass `null` to
 * clear it. Other custom metrics on the session are left untouched.
 */
export async function setSessionCustomMetric(
  sessionId: string,
  definitionId: string,
  value: CustomMetricEntry | null,
): Promise<TrainingLogSession> {
  const { data: row, error: rErr } = await supabase
    .from('training_log_sessions')
    .select('custom_metrics')
    .eq('id', sessionId)
    .single();
  if (rErr) throw rErr;
  const current = ((row as { custom_metrics?: Record<string, CustomMetricEntry> } | null)
    ?.custom_metrics ?? {}) as Record<string, CustomMetricEntry>;
  const next: Record<string, CustomMetricEntry> = { ...current };
  if (value === null) delete next[definitionId];
  else next[definitionId] = value;
  const { data, error } = await supabase
    .from('training_log_sessions')
    .update({ custom_metrics: next } as never)
    .eq('id', sessionId)
    .select()
    .single();
  if (error) throw error;
  return data as TrainingLogSession;
}

/**
 * PR table for the profile screen. Sorted by value descending so the
 * heaviest lifts top the list.
 */
export async function fetchAthletePRs(athleteId: string): Promise<AthletePRRow[]> {
  // Pulls category alongside the name so the "— System" sentinel
  // exercises (TEXT / IMAGE / VIDEO / GPP placeholders) can be
  // filtered out before the row reaches Profile / PR consumers.
  const { data, error } = await supabase
    .from('athlete_prs')
    .select('exercise_id, pr_value_kg, pr_date, exercise:exercise_id(name, category)')
    .eq('athlete_id', athleteId)
    .order('pr_value_kg', { ascending: false });
  if (error) throw error;
  return (
    (data ?? []) as unknown as Array<{
      exercise_id: string;
      pr_value_kg: number | null;
      pr_date: string | null;
      exercise: { name: string; category: string | null } | null;
    }>
  )
    .filter(r => r.pr_value_kg != null && r.exercise?.category !== '— System')
    .map(r => ({
      exerciseId: r.exercise_id,
      exerciseName: r.exercise?.name ?? '(unknown)',
      prValueKg: r.pr_value_kg,
      prDate: r.pr_date,
    }));
}
