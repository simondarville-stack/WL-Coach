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
import { LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchAthleteDay,
  fetchWeekOverview,
  ensureSession,
  updateSession,
  ensureLogExercise,
  updateLogExercise,
  upsertLoggedSet,
  type AthleteDayData,
  type PlannedExerciseFull,
  type WeekOverview,
} from '../../../lib/trainingLogService';
import type { TrainingLogSession, TrainingLogSet } from '../../../lib/database.types';
import { SessionHeader } from '../components/SessionHeader';
import { ExerciseLogCard } from '../components/ExerciseLogCard';
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
  const { athlete, signOut } = useAuth();

  const [weekStart, setWeekStart] = useState<string>(() => getMondayOf(new Date()));
  const [overview, setOverview] = useState<WeekOverview | null>(null);
  const [dayIndex, setDayIndex] = useState<number | null>(null);
  const [data, setData] = useState<AthleteDayData | null>(null);
  const [loadingWeek, setLoadingWeek] = useState(true);
  const [loadingDay, setLoadingDay] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const loggedSetsByPlannedId = useMemo(() => {
    const m = new Map<string, TrainingLogSet[]>();
    data?.log?.exercises.forEach(le => {
      if (le.log.planned_exercise_id) m.set(le.log.planned_exercise_id, le.sets);
    });
    return m;
  }, [data]);

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

  const withSaving = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setSaving(true);
    try {
      return await fn();
    } finally {
      setSaving(false);
    }
  };

  const patchSession = async (patch: Parameters<typeof updateSession>[1]) => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      await updateSession(session.id, patch);
      await Promise.all([loadDay(), loadWeek()]);
    });
  };

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

  const handlePatchSessionRpe = (rpe: number | null) => patchSession({ session_rpe: rpe });

  const ensureLogEx = async (planned: PlannedExerciseFull, sessionId: string) =>
    ensureLogExercise({
      sessionId,
      plannedExerciseId: planned.exercise.id,
      exerciseId: planned.exercise.exercise_id,
      position: planned.exercise.position,
    });

  const handleSaveSet = (planned: PlannedExerciseFull) => async (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    rpe: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      await upsertLoggedSet({
        logExerciseId: logEx.id,
        setNumber: patch.setNumber,
        plannedLoad: patch.plannedLoad,
        plannedReps: patch.plannedReps,
        performedLoad: patch.performedLoad,
        performedReps: patch.performedReps,
        rpe: patch.rpe,
        status: patch.status,
      });
      if (logEx.status === 'pending' && patch.status !== 'pending') {
        await updateLogExercise(logEx.id, {
          status: 'in_progress',
          started_at: logEx.started_at ?? new Date().toISOString(),
        });
      }
      await Promise.all([loadDay(), loadWeek()]);
    });
  };

  const handleLogAsPrescribed = (planned: PlannedExerciseFull) => async () => {
    await withSaving(async () => {
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
      await Promise.all([loadDay(), loadWeek()]);
    });
  };

  const handleUpdateExerciseNotes = (planned: PlannedExerciseFull) => async (notes: string) => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      await updateLogExercise(logEx.id, { performed_notes: notes });
      await loadDay();
    });
  };

  const handleMarkComplete = (planned: PlannedExerciseFull) => async () => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogEx(planned, session.id);
      await updateLogExercise(logEx.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        started_at: logEx.started_at ?? new Date().toISOString(),
      });
      await Promise.all([loadDay(), loadWeek()]);
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const selectedOverviewDay =
    dayIndex != null ? overview?.days.find(d => d.dayIndex === dayIndex) ?? null : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-gray-400">
            Logging as <span className="text-gray-200 font-medium">{athlete.name}</span>
          </div>
          <button
            onClick={signOut}
            className="p-2 hover:bg-gray-900 rounded-md text-gray-400 hover:text-white"
            title="Switch profile"
          >
            <LogOut size={16} />
          </button>
        </div>

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
            {overview.planSource === 'group' && (
              <p className="text-[10px] text-gray-500 italic px-1">
                Showing your group's plan.
              </p>
            )}
          </>
        ) : null}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {dayIndex != null && (
          <PerformedOnField
            date={performedOnDate}
            sessionExists={!!data?.log?.session}
            onChange={handlePatchPerformedOn}
          />
        )}

        {loadingDay ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading session…</span>
          </div>
        ) : data && dayIndex != null ? (
          <>
            <SessionHeader
              date={performedOnDate}
              slotLabel={selectedOverviewDay?.label ?? `Day ${dayIndex}`}
              session={data.log?.session ?? null}
              onPatchBodyweight={handlePatchBodyweight}
              onPatchRaw={handlePatchRaw}
              onPatchNotes={handlePatchNotes}
              onPatchSessionRpe={handlePatchSessionRpe}
              saving={saving}
            />

            <div className="space-y-2">
              {data.planned.length === 0 ? (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
                  <p className="text-sm text-gray-400">No exercises in this slot.</p>
                  <p className="text-xs text-gray-500 mt-1">Pick another day or check with your coach.</p>
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
            </div>
          </>
        ) : null}
      </div>
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
