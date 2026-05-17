/**
 * TodayScreen — the athlete picks WHICH training slot they're doing this
 * week, then logs it. The calendar date is metadata, not the key: athletes
 * routinely do Day 2 on Wednesday because Tuesday got skipped.
 *
 * State model:
 *   - weekStart: Monday of the week being viewed
 *   - dayIndex: which planned slot (1-N) the athlete is logging
 *   - "Performed on" date: stored as session.date, editable, defaults to
 *     today on first log
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Plus, CheckCircle, Eye } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchAthleteDay,
  fetchWeekOverview,
  ensureSession,
  updateSession,
  ensureLogExercise,
  updateLogExercise,
  upsertLoggedSet,
  addOffPlanLogExercise,
  createBonusSession,
  type AthleteDayData,
  type PlannedExerciseFull,
  type WeekOverview,
} from '../../../lib/trainingLogService';
import type { TrainingLogSession, TrainingLogSet } from '../../../lib/database.types';
import { SessionHeader } from '../components/SessionHeader';
import { SessionPreview } from '../components/SessionPreview';
import { ExerciseLogCard } from '../components/ExerciseLogCard';
import { OffPlanExerciseCard } from '../components/OffPlanExerciseCard';
import { ExercisePicker } from '../components/ExercisePicker';
import type { RawScores } from '../components/RawScoreDial';
import { expandSetLines } from '../components/SetEntryRow';
import { WeekNavigator, getMondayOf, toISO } from '../components/WeekNavigator';
import { DayChipRow } from '../components/DayChipRow';

function todayISO(): string {
  return toISO(new Date());
}

function todayDayIndex(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

/**
 * Pick a sensible default slot when the athlete first lands on the screen:
 * 1. The slot that matches today's weekday if it's active
 * 2. The earliest active slot that isn't completed
 * 3. The first active slot
 * 4. null (no plan)
 */
function pickDefaultDay(overview: WeekOverview): number | null {
  if (overview.days.length === 0) return null;
  const today = todayDayIndex();
  const matchingToday = overview.days.find(d => d.weekday === today);
  if (matchingToday) return matchingToday.dayIndex;
  const firstUnfinished = overview.days.find(d => d.status !== 'completed');
  if (firstUnfinished) return firstUnfinished.dayIndex;
  return overview.days[0].dayIndex;
}

export function TodayScreen() {
  const { athlete } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Seed from URL so a Week-screen tap lands on the right slot. We
  // defer to URL params over the heuristic default when both are valid.
  const urlWeek = searchParams.get('week');
  const urlSlot = searchParams.get('slot');
  const [weekStart, setWeekStart] = useState<string>(
    () => urlWeek ?? getMondayOf(new Date()),
  );
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [dayIndex, setDayIndex] = useState<number | null>(
    () => (urlSlot != null ? Number.parseInt(urlSlot, 10) : null),
  );
  const [data, setData] = useState<AthleteDayData | null>(null);
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  /**
   * 'preview' renders the session like the coach's print view, no
   * inputs. 'edit' is the full logging UI. Defaults to 'preview';
   * "Start logging" enters edit, and the user can switch back via
   * the eye toggle in SessionHeader.
   */
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');

  const loadWeek = useCallback(async () => {
    if (!athlete) return;
    setLoadingWeek(true);
    setError(null);
    try {
      const w = await fetchWeekOverview(athlete.id, weekStart);
      setOverview(w);
      setDayIndex(prev => {
        if (prev != null && w.days.some(d => d.dayIndex === prev)) return prev;
        return pickDefaultDay(w);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingWeek(false);
    }
  }, [athlete, weekStart]);

  const loadDay = useCallback(async () => {
    if (!athlete || dayIndex == null) {
      setData(null);
      return;
    }
    setLoadingDay(true);
    setError(null);
    try {
      const d = await fetchAthleteDay(athlete.id, weekStart, dayIndex);
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDay(false);
    }
  }, [athlete, weekStart, dayIndex]);

  useEffect(() => { void loadWeek(); }, [loadWeek]);
  useEffect(() => { void loadDay(); }, [loadDay]);

  // Consume URL params once so subsequent in-screen navigation doesn't
  // fight with stale ?week/slot from the Week screen tap-through.
  useEffect(() => {
    if (urlWeek || urlSlot != null) {
      setSearchParams({}, { replace: true });
    }
  }, [urlWeek, urlSlot, setSearchParams]);

  // Resetting mode to preview on slot change is the desired default;
  // user explicitly hits "Start logging" to enter edit mode.
  useEffect(() => {
    setMode('preview');
  }, [dayIndex, weekStart]);

  const loggedSetsByPlannedId = useMemo(() => {
    const m = new Map<string, TrainingLogSet[]>();
    data?.log?.exercises.forEach(le => {
      if (le.log.planned_exercise_id) m.set(le.log.planned_exercise_id, le.sets);
    });
    return m;
  }, [data]);

  const offPlanLogged = useMemo(
    () => (data?.log?.exercises ?? []).filter(le => !le.log.planned_exercise_id),
    [data],
  );

  if (!athlete) return null;

  // ─── Mutation helpers ────────────────────────────────────────────────────

  const performedOnDate =
    data?.log?.session?.date ?? todayISO();

  const getOrCreateSession = async (): Promise<TrainingLogSession> => {
    if (data?.log?.session) return data.log.session;
    if (dayIndex == null) throw new Error('No day selected');
    return ensureSession({
      athleteId: athlete.id,
      ownerId: athlete.owner_id,
      date: todayISO(),
      weekStart,
      dayIndex,
    });
  };

  /**
   * Run a save action without thrashing the page.
   *
   * Pure wrapper: sets `saving`, surfaces errors, and recovers via
   * loadDay on failure. It does NOT reload on success — each caller
   * is responsible for merging the server response into local state
   * (patchSession) or deciding when a reload is needed (set saves
   * after a brand-new session, off-plan additions).
   */
  const runSave = async (fn: () => Promise<void>) => {
    setSaving(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await loadDay();
    } finally {
      setSaving(false);
    }
  };

  const patchSession = (patch: Parameters<typeof updateSession>[1]) =>
    runSave(async () => {
      const session = await getOrCreateSession();
      const updated = await updateSession(session.id, patch);
      // In-place local merge so RAW taps / BW edits don't trigger a full
      // re-fetch (which would rebuild every set-row reference and reset
      // the user's mid-tap state in RawScoreDial / SetEntryRow). The
      // first-save reload (runSave's wasNewSession path) still hydrates
      // the full structure.
      setData(prev => {
        if (!prev) return prev;
        const prevLog = prev.log;
        if (!prevLog) {
          return {
            ...prev,
            log: {
              date: updated.date,
              dayIndex: updated.day_index,
              session: updated,
              exercises: [],
              messages: [],
            },
          };
        }
        return { ...prev, log: { ...prevLog, session: updated } };
      });
    });

  const handlePatchPerformedOn = async (next: string) => {
    if (next === performedOnDate) return;
    await patchSession({ date: next });
  };

  const handlePatchBodyweight = (bw: number | null) => patchSession({ bodyweight_kg: bw });

  const handlePatchRaw = (raw: RawScores, total: number | null) =>
    patchSession({
      raw_sleep: raw.sleep,
      raw_physical: raw.physical,
      raw_mood: raw.mood,
      raw_nutrition: raw.nutrition,
      raw_total: total,
    });

  const handlePatchNotes = (notes: string) => patchSession({ session_notes: notes });

  const ensureLogEx = async (planned: PlannedExerciseFull, sessionId: string) =>
    ensureLogExercise({
      sessionId,
      plannedExerciseId: planned.exercise.id,
      exerciseId: planned.exercise.exercise_id,
      position: planned.exercise.position,
    });

  const handleSaveSet = (planned: PlannedExerciseFull) => (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) =>
    runSave(async () => {
      const wasNewSession = !data?.log?.session;
      const wasNewLogEx = !data?.log?.exercises.some(
        e => e.log.planned_exercise_id === planned.exercise.id,
      );
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      await upsertLoggedSet({
        logExerciseId: logEx.id,
        setNumber: patch.setNumber,
        plannedLoad: patch.plannedLoad,
        plannedReps: patch.plannedReps,
        performedLoad: patch.performedLoad,
        performedReps: patch.performedReps,
        rpe: null,
        status: patch.status,
      });
      if (logEx.status === 'pending' && patch.status !== 'pending') {
        await updateLogExercise(logEx.id, {
          status: 'in_progress',
          started_at: logEx.started_at ?? new Date().toISOString(),
        });
      }
      // First time a session or log_exercise comes into existence we
      // need a reload to hydrate their server-side ids locally so the
      // next save doesn't race. Subsequent set edits don't reload —
      // SetEntryRow holds its own check/input state.
      if (wasNewSession || wasNewLogEx) {
        await loadDay();
      }
    });

  const handleLogAsPrescribed = (planned: PlannedExerciseFull) => () =>
    runSave(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      const rows = expandSetLines(planned.setLines);
      for (const row of rows) {
        await upsertLoggedSet({
          logExerciseId: logEx.id,
          setNumber: row.setNumber,
          plannedLoad: row.plannedLoadValue,
          plannedReps: row.plannedRepsValue,
          performedLoad: row.plannedLoadValue,
          performedReps: row.plannedRepsValue,
          rpe: null,
          status: 'completed',
        });
      }
      await updateLogExercise(logEx.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        started_at: logEx.started_at ?? new Date().toISOString(),
      });
      // "Log as prescribed" makes large local changes; a reload here is
      // worth the small flicker because the user has stopped editing.
      await loadDay();
    });

  const handleUpdateExerciseNotes = (planned: PlannedExerciseFull) => (notes: string) =>
    runSave(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      await updateLogExercise(logEx.id, { performed_notes: notes });
    });

  const handleMarkComplete = (planned: PlannedExerciseFull) => () =>
    runSave(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      await updateLogExercise(logEx.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        started_at: logEx.started_at ?? new Date().toISOString(),
      });
    });

  const handleAddOffPlanExercise = async (ex: { id: string; name: string; color: string | null }) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      await addOffPlanLogExercise({
        sessionId: session.id,
        exerciseId: ex.id,
      });
      // Off-plan additions need a reload to pull the new log_exercise
      // and its empty set list into local state.
      await loadDay();
    });
  };

  const handleFinishSession = async () => {
    if (!data?.log?.session) return;
    await patchSession({
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    setMode('preview');
  };

  const handleAddBonusDay = async () => {
    if (!overview) return;
    const existingMax = overview.days.reduce(
      (max, d) => Math.max(max, d.dayIndex),
      overview.activeDays.length > 0 ? Math.max(...overview.activeDays) : 0,
    );
    const nextDayIndex = existingMax + 1;
    setSaving(true);
    setError(null);
    try {
      await createBonusSession({
        athleteId: athlete.id,
        ownerId: athlete.owner_id,
        weekStart,
        dayIndex: nextDayIndex,
        date: todayISO(),
      });
      await loadWeek();
      setDayIndex(nextDayIndex);
      setMode('edit');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOffPlanSet = (logExerciseId: string) => (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) =>
    runSave(async () => {
      await upsertLoggedSet({
        logExerciseId,
        setNumber: patch.setNumber,
        plannedLoad: null,
        plannedReps: null,
        performedLoad: patch.performedLoad,
        performedReps: patch.performedReps,
        rpe: null,
        status: patch.status,
      });
      // Refresh so a newly-inserted set picks up its real id locally
      // for subsequent edits.
      await loadDay();
    });

  // ─── Render ──────────────────────────────────────────────────────────────

  const selectedOverviewDay =
    dayIndex != null ? overview?.days.find(d => d.dayIndex === dayIndex) ?? null : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <WeekNavigator weekStart={weekStart} onChange={setWeekStart} />

        {loadingWeek ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading week…</span>
          </div>
        ) : overview && overview.days.length === 0 ? (
          <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
            <p className="text-sm text-gray-300 font-semibold">No plan for this week</p>
            <p className="text-xs text-gray-500 mt-1">
              Your coach hasn't written a plan yet. Try the previous or next week.
            </p>
          </div>
        ) : overview ? (
          <>
            <DayChipRow
              days={overview.days}
              selectedDayIndex={dayIndex}
              onSelect={setDayIndex}
            />
            <div className="flex items-center justify-between gap-2 px-1">
              {overview.planSource === 'group' ? (
                <p className="text-[10px] text-gray-500 italic">Showing your group's plan.</p>
              ) : <span />}
              <button
                onClick={handleAddBonusDay}
                disabled={saving}
                className="inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white px-2 py-1 rounded border border-dashed border-gray-700 hover:border-gray-500 disabled:opacity-50"
                title="Log an extra training day this week"
              >
                <Plus size={11} />
                Training day
              </button>
            </div>
          </>
        ) : null}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {loadingDay ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading session…</span>
          </div>
        ) : data && dayIndex != null && mode === 'preview' ? (
          <SessionPreview
            slotLabel={selectedOverviewDay?.label ?? `Day ${dayIndex}`}
            weekdayLabel={
              selectedOverviewDay?.weekday != null
                ? new Date(performedOnDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })
                : null
            }
            date={performedOnDate}
            planned={data.planned}
            isBonus={selectedOverviewDay?.isBonus}
            onStart={() => setMode('edit')}
          />
        ) : data && dayIndex != null ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <PerformedOnField
                date={performedOnDate}
                sessionExists={!!data.log?.session}
                onChange={handlePatchPerformedOn}
              />
              <button
                onClick={() => setMode('preview')}
                className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white px-2 py-2 rounded-md border border-gray-800 hover:border-gray-600"
                title="Back to preview"
              >
                <Eye size={12} />
                Preview
              </button>
            </div>

            <SessionHeader
              date={performedOnDate}
              slotLabel={selectedOverviewDay?.label ?? `Day ${dayIndex}`}
              session={data.log?.session ?? null}
              onPatchBodyweight={handlePatchBodyweight}
              onPatchRaw={handlePatchRaw}
              onPatchNotes={handlePatchNotes}
              saving={saving}
            />

            <div className="space-y-2">
              {data.planned.length === 0 && offPlanLogged.length === 0 ? (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
                  <p className="text-sm text-gray-400">No exercises yet.</p>
                  <p className="text-xs text-gray-500 mt-1">Tap "Add exercise" to log what you did.</p>
                </div>
              ) : (
                data.planned.map(p => {
                  const loggedExercise =
                    data.log?.exercises.find(e => e.log.planned_exercise_id === p.exercise.id)?.log ?? null;
                  return (
                    <ExerciseLogCard
                      key={p.exercise.id}
                      planned={p}
                      loggedExercise={loggedExercise}
                      loggedSets={loggedSetsByPlannedId.get(p.exercise.id) ?? []}
                      onSaveSet={handleSaveSet(p)}
                      onLogAsPrescribed={handleLogAsPrescribed(p)}
                      onUpdateNotes={handleUpdateExerciseNotes(p)}
                      onMarkComplete={handleMarkComplete(p)}
                    />
                  );
                })
              )}

              {offPlanLogged.map(le => (
                <OffPlanExerciseCard
                  key={le.log.id}
                  logExercise={le.log}
                  exercise={le.exercise}
                  loggedSets={le.sets}
                  onSaveSet={handleSaveOffPlanSet(le.log.id)}
                />
              ))}

              <button
                onClick={() => setShowPicker(true)}
                className="w-full inline-flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white py-2.5 border border-dashed border-gray-700 hover:border-gray-500 rounded-xl"
              >
                <Plus size={14} />
                Add exercise
              </button>

              {data.log?.session && data.log.session.status !== 'completed' && (
                <button
                  onClick={handleFinishSession}
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white font-semibold text-sm py-3 rounded-xl mt-2 transition-colors"
                >
                  <CheckCircle size={16} />
                  Finish session
                </button>
              )}
              {data.log?.session?.status === 'completed' && (
                <div className="text-center text-[11px] text-emerald-400 italic mt-1">
                  Session marked complete · you can keep editing if you missed something
                </div>
              )}
            </div>
          </>
        ) : null}

        <ExercisePicker
          open={showPicker}
          onClose={() => setShowPicker(false)}
          onPick={handleAddOffPlanExercise}
        />
    </div>
  );
}

function PerformedOnField({
  date,
  sessionExists,
  onChange,
}: {
  date: string;
  sessionExists: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 flex items-center justify-between gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
          Performed on
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {sessionExists ? 'Stored date' : 'Defaults to today; saved when you log anything'}
        </div>
      </div>
      <input
        type="date"
        value={date}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}
