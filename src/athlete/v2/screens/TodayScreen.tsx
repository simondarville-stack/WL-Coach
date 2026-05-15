/**
 * TodayScreen — the athlete's daily log entry point.
 *
 * Lets the athlete pick a date (defaults to today), see the planned
 * session, log sets, set BW + RAW + RPE + notes. Everything routes
 * through trainingLogService.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, LogOut, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';
import {
  fetchAthleteDay,
  ensureSession,
  updateSession,
  ensureLogExercise,
  updateLogExercise,
  upsertLoggedSet,
  type AthleteDayData,
  type PlannedExerciseFull,
} from '../../../lib/trainingLogService';
import type { TrainingLogSession, TrainingLogSet } from '../../../lib/database.types';
import { SessionHeader } from '../components/SessionHeader';
import { ExerciseLogCard } from '../components/ExerciseLogCard';
import type { RawScores } from '../components/RawScoreDial';
import { expandSetLines } from '../components/SetEntryRow';

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getDayIndex(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  return day === 0 ? 7 : day;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function TodayScreen() {
  const { athlete, signOut } = useAuth();
  const [date, setDate] = useState<string>(() => toISODate(new Date()));
  const [data, setData] = useState<AthleteDayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const dayIndex = useMemo(() => getDayIndex(date), [date]);
  const weekStart = useMemo(
    () => toISODate(getMonday(new Date(date + 'T00:00:00'))),
    [date],
  );

  const load = useCallback(async () => {
    if (!athlete) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchAthleteDay(athlete.id, date, weekStart, dayIndex);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [athlete, date, weekStart, dayIndex]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!athlete) return null;

  // ─── Mutation helpers ────────────────────────────────────────────────────

  // Lazily ensure a session row exists before any write.
  const getOrCreateSession = async (): Promise<TrainingLogSession> => {
    if (data?.log?.session) return data.log.session;
    const session = await ensureSession({
      athleteId: athlete.id,
      ownerId: athlete.owner_id,
      date,
      weekStart,
      dayIndex,
    });
    return session;
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
      await load();
    });
  };

  const handlePatchBodyweight = async (bw: number | null) => {
    await patchSession({ bodyweight_kg: bw });
  };

  const handlePatchRaw = async (raw: RawScores, total: number | null) => {
    await patchSession({
      raw_sleep: raw.sleep,
      raw_physical: raw.physical,
      raw_mood: raw.mood,
      raw_nutrition: raw.nutrition,
      raw_total: total,
    });
  };

  const handlePatchNotes = async (notes: string) => {
    await patchSession({ session_notes: notes });
  };

  const handlePatchSessionRpe = async (rpe: number | null) => {
    await patchSession({ session_rpe: rpe });
  };

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
      const logEx = await ensureLogExercise({
        sessionId: session.id,
        plannedExerciseId: planned.exercise.id,
        exerciseId: planned.exercise.exercise_id,
        position: planned.exercise.position,
      });
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
      // If we just logged something but the exercise is still pending, bump it.
      if (logEx.status === 'pending' && patch.status !== 'pending') {
        await updateLogExercise(logEx.id, {
          status: 'in_progress',
          started_at: logEx.started_at ?? new Date().toISOString(),
        });
      }
      await load();
    });
  };

  const handleLogAsPrescribed = (planned: PlannedExerciseFull) => async () => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogExercise({
        sessionId: session.id,
        plannedExerciseId: planned.exercise.id,
        exerciseId: planned.exercise.exercise_id,
        position: planned.exercise.position,
      });
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
      await load();
    });
  };

  const handleUpdateExerciseNotes = (planned: PlannedExerciseFull) => async (notes: string) => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogExercise({
        sessionId: session.id,
        plannedExerciseId: planned.exercise.id,
        exerciseId: planned.exercise.exercise_id,
        position: planned.exercise.position,
      });
      await updateLogExercise(logEx.id, { performed_notes: notes });
      await load();
    });
  };

  const handleMarkComplete = (planned: PlannedExerciseFull) => async () => {
    await withSaving(async () => {
      const session = await getOrCreateSession();
      const logEx = await ensureLogExercise({
        sessionId: session.id,
        plannedExerciseId: planned.exercise.id,
        exerciseId: planned.exercise.exercise_id,
        position: planned.exercise.position,
      });
      await updateLogExercise(logEx.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        started_at: logEx.started_at ?? new Date().toISOString(),
      });
      await load();
    });
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const loggedExercisesByPlannedId = new Map<
    string,
    { exerciseId: string | null; status: string; notes: string; loggedSets: TrainingLogSet[] }
  >();
  data?.log?.exercises.forEach(le => {
    if (le.log.planned_exercise_id) {
      loggedExercisesByPlannedId.set(le.log.planned_exercise_id, {
        exerciseId: le.log.id,
        status: le.log.status,
        notes: le.log.performed_notes,
        loggedSets: le.sets,
      });
    }
  });

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setDate(d => addDays(d, -1))}
              className="p-2 hover:bg-gray-900 rounded-md text-gray-400 hover:text-white"
              aria-label="Previous day"
            >
              <ChevronLeft size={18} />
            </button>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="bg-gray-900 border border-gray-800 rounded-md px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            />
            <button
              onClick={() => setDate(d => addDays(d, 1))}
              className="p-2 hover:bg-gray-900 rounded-md text-gray-400 hover:text-white"
              aria-label="Next day"
            >
              <ChevronRight size={18} />
            </button>
            <button
              onClick={() => setDate(toISODate(new Date()))}
              className="text-xs text-gray-400 hover:text-white px-2 py-1.5 rounded-md hover:bg-gray-900 ml-1"
            >
              Today
            </button>
          </div>
          <button
            onClick={signOut}
            className="p-2 hover:bg-gray-900 rounded-md text-gray-400 hover:text-white"
            title="Switch profile"
          >
            <LogOut size={16} />
          </button>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <SessionHeader
              date={date}
              athleteName={athlete.name}
              session={data.log?.session ?? null}
              onPatchBodyweight={handlePatchBodyweight}
              onPatchRaw={handlePatchRaw}
              onPatchNotes={handlePatchNotes}
              onPatchSessionRpe={handlePatchSessionRpe}
              saving={saving}
            />

            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mt-2 px-1">
                Today's session
              </div>
              {data.planned.length === 0 ? (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
                  <p className="text-sm text-gray-400">No session planned for this day.</p>
                  <p className="text-xs text-gray-500 mt-1">Pick another date or check with your coach.</p>
                </div>
              ) : (
                data.planned.map(p => {
                  const logged = loggedExercisesByPlannedId.get(p.exercise.id);
                  const loggedExercise = data.log?.exercises.find(
                    e => e.log.planned_exercise_id === p.exercise.id,
                  )?.log ?? null;
                  return (
                    <ExerciseLogCard
                      key={p.exercise.id}
                      planned={p}
                      loggedExercise={loggedExercise}
                      loggedSets={logged?.loggedSets ?? []}
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
        )}
      </div>
    </div>
  );
}
