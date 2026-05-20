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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, Plus, CheckCircle, Eye, Trash2 } from 'lucide-react';
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
  addComment,
  deleteLogExercise,
  deleteSession,
  deleteLoggedSet,
  removePlannedSet,
  setLogExerciseGppSection,
  setSessionCustomMetric,
  setSubstitutedExercise,
  type AthleteDayData,
  type PlannedExerciseFull,
  type WeekOverview,
} from '../../../lib/trainingLogService';
import type {
  CustomMetricEntry,
  GppSection,
  TrainingLogSession,
  TrainingLogSet,
} from '../../../lib/database.types';
import { SessionHeader } from '../components/SessionHeader';
import { SessionPreview } from '../components/SessionPreview';
import { ExerciseLogCard } from '../components/ExerciseLogCard';
import { OffPlanExerciseCard } from '../components/OffPlanExerciseCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { AthleteCommentsThread } from '../components/AthleteCommentsThread';
import type { RawScores } from '../components/RawScoreDial';
import type { SetRowInput } from '../components/SetEntryRow';
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
  /** When set, the exercise picker opens in substitution mode for a
   *  specific planned exercise. */
  const [substituting, setSubstituting] = useState<PlannedExerciseFull | null>(null);
  /**
   * 'preview' renders the session like the coach's print view, no
   * inputs. 'edit' is the full logging UI. Defaults to 'preview';
   * "Start logging" enters edit, and the user can switch back via
   * the eye toggle in SessionHeader.
   */
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  /**
   * One-shot bypass for the preview-on-slot-change effect, so that
   * explicit setMode('edit') after bonus-day creation isn't immediately
   * overwritten by the auto-reset.
   */
  const skipPreviewReset = useRef(false);

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
  // user explicitly hits "Start logging" to enter edit mode. The
  // skipPreviewReset ref bypasses this for the bonus-day create flow,
  // which programmatically jumps the user straight into edit mode.
  useEffect(() => {
    if (skipPreviewReset.current) {
      skipPreviewReset.current = false;
      return;
    }
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
      mergeSession(updated);
    });

  const handlePatchPerformedOn = async (next: string) => {
    if (next === performedOnDate) return;
    await patchSession({ date: next });
  };

  // ─── In-place data merges (avoid full reloads on every save) ────────────

  const mergeSession = (session: TrainingLogSession) => {
    setData(prev => {
      if (!prev) return prev;
      if (!prev.log) {
        return {
          ...prev,
          log: {
            date: session.date,
            dayIndex: session.day_index,
            session,
            exercises: [],
            messages: [],
          },
        };
      }
      return { ...prev, log: { ...prev.log, session } };
    });
  };

  const mergeLogExercise = (
    logEx: import('../../../lib/database.types').TrainingLogExercise,
    exerciseDef: import('../../../lib/database.types').Exercise | null,
  ) => {
    setData(prev => {
      if (!prev?.log) return prev;
      const existing = prev.log.exercises.find(le => le.log.id === logEx.id);
      if (existing) {
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.map(le =>
              le.log.id === logEx.id ? { ...le, log: logEx } : le,
            ),
          },
        };
      }
      return {
        ...prev,
        log: {
          ...prev.log,
          exercises: [...prev.log.exercises, { log: logEx, sets: [], exercise: exerciseDef }],
        },
      };
    });
  };

  const mergeLoggedSet = (savedSet: TrainingLogSet) => {
    setData(prev => {
      if (!prev?.log) return prev;
      return {
        ...prev,
        log: {
          ...prev.log,
          exercises: prev.log.exercises.map(le => {
            if (le.log.id !== savedSet.log_exercise_id) return le;
            const idx = le.sets.findIndex(s => s.id === savedSet.id);
            const sets =
              idx >= 0
                ? le.sets.map(s => (s.id === savedSet.id ? savedSet : s))
                : [...le.sets, savedSet].sort((a, b) => a.set_number - b.set_number);
            return { ...le, sets };
          }),
        },
      };
    });
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

  const handlePatchVas = (vas: number | null) => patchSession({ vas_score: vas });

  const handlePatchCustomMetric = (defId: string, value: CustomMetricEntry | null) =>
    runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const updated = await setSessionCustomMetric(session.id, defId, value);
      mergeSession(updated);
    });

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
    performedText?: string | null;
  }) =>
    runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      mergeLogExercise(logEx, planned.exerciseDef);
      const savedSet = await upsertLoggedSet({
        logExerciseId: logEx.id,
        setNumber: patch.setNumber,
        plannedLoad: patch.plannedLoad,
        plannedReps: patch.plannedReps,
        performedLoad: patch.performedLoad,
        performedReps: patch.performedReps,
        rpe: null,
        status: patch.status,
        notes: patch.performedText ?? null,
      });
      mergeLoggedSet(savedSet);
      // No exercise-level auto-bump; binary states only — exercise
      // status moves to 'completed' explicitly via Mark complete.
    });

  const handleLogAsPrescribed = (planned: PlannedExerciseFull) => (rows: SetRowInput[]) =>
    runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      mergeLogExercise(logEx, planned.exerciseDef);
      for (const row of rows) {
        const savedSet = await upsertLoggedSet({
          logExerciseId: logEx.id,
          setNumber: row.setNumber,
          plannedLoad: row.plannedLoadValue,
          plannedReps: row.plannedRepsValue,
          performedLoad: row.plannedLoadValue,
          performedReps: row.plannedRepsValue,
          rpe: null,
          status: 'completed',
        });
        mergeLoggedSet(savedSet);
      }
      const updatedLogEx = await updateLogExercise(logEx.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        started_at: logEx.started_at ?? new Date().toISOString(),
      });
      mergeLogExercise(updatedLogEx, planned.exerciseDef);
    });

  const handleUpdateExerciseNotes = (planned: PlannedExerciseFull) => (notes: string) =>
    runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      const updated = await updateLogExercise(logEx.id, { performed_notes: notes });
      mergeLogExercise(updated, planned.exerciseDef);
    });

  const handleMarkComplete = (planned: PlannedExerciseFull) => () =>
    runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      const updated = await updateLogExercise(logEx.id, {
        status: 'completed',
        completed_at: new Date().toISOString(),
        started_at: logEx.started_at ?? new Date().toISOString(),
      });
      mergeLogExercise(updated, planned.exerciseDef);
    });

  const handlePostComment = async (body: string) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const msg = await addComment({
        sessionId: session.id,
        exerciseId: null,
        message: body,
        senderType: 'athlete',
      });
      setData(prev => {
        if (!prev?.log) return prev;
        return {
          ...prev,
          log: { ...prev.log, messages: [...prev.log.messages, msg] },
        };
      });
    });
  };

  const handleDeleteSet = async (setId: string) => {
    if (!window.confirm('Delete this set?')) return;
    await runSave(async () => {
      await deleteLoggedSet(setId);
      setData(prev => {
        if (!prev?.log) return prev;
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.map(le => ({
              ...le,
              sets: le.sets.filter(s => s.id !== setId),
            })),
          },
        };
      });
    });
  };

  /** Persist athlete-side GPP edits + done state. */
  const handleSaveGppSection = (planned: PlannedExerciseFull) => async (section: GppSection) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      mergeLogExercise(logEx, planned.exerciseDef);
      const updated = await setLogExerciseGppSection(logEx.id, section);
      mergeLogExercise(updated, planned.exerciseDef);
    });
  };

  /**
   * Drop a planned set the athlete never touched. We ensure the log
   * exercise exists so we have somewhere to persist the removal, then
   * append the set number into metadata.removed_set_numbers.
   * ExerciseLogCard filters its rendered rows by that list.
   */
  const handleRemovePlannedSet = (planned: PlannedExerciseFull) => async (setNumber: number) => {
    if (!window.confirm('Remove this set from your plan?')) return;
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      mergeLogExercise(logEx, planned.exerciseDef);
      const updated = await removePlannedSet(logEx.id, setNumber);
      mergeLogExercise(updated, planned.exerciseDef);
    });
  };

  const handleDeleteOffPlanExercise = async (logExerciseId: string) => {
    if (!window.confirm('Remove this exercise from your log?')) return;
    await runSave(async () => {
      await deleteLogExercise(logExerciseId);
      setData(prev => {
        if (!prev?.log) return prev;
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.filter(le => le.log.id !== logExerciseId),
          },
        };
      });
    });
  };

  const handleDeleteBonusDay = async () => {
    if (!data?.log?.session) return;
    if (
      !window.confirm(
        'Delete this entire training day, including all logged exercises? This cannot be undone.',
      )
    )
      return;
    const sessionId = data.log.session.id;
    await runSave(async () => {
      await deleteSession(sessionId);
      // Reload week + pick a new selection.
      await loadWeek();
      setDayIndex(prev =>
        overview?.days.find(d => d.dayIndex !== prev)?.dayIndex ?? null,
      );
      setMode('preview');
    });
  };

  const handleSubstitute = async (
    planned: PlannedExerciseFull,
    pick: { id: string; name: string; color: string | null },
  ) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const logEx = await ensureLogEx(planned, session.id);
      mergeLogExercise(logEx, planned.exerciseDef);
      const updated = await setSubstitutedExercise(logEx.id, pick.id);
      // Replace the exercise reference locally so the substitution
      // surfaces without a full reload.
      setData(prev => {
        if (!prev?.log) return prev;
        const partial = { id: pick.id, name: pick.name, color: pick.color } as unknown as
          import('../../../lib/database.types').Exercise;
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.map(le =>
              le.log.id === logEx.id ? { ...le, log: updated, exercise: partial } : le,
            ),
          },
        };
      });
    });
  };

  const handleAddOffPlanExercise = async (ex: { id: string; name: string; color: string | null }) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const newLogEx = await addOffPlanLogExercise({
        sessionId: session.id,
        exerciseId: ex.id,
      });
      // The picker only carries id/name/color; cast a partial Exercise
      // since OffPlanExerciseCard only reads those two fields.
      const partial = { id: ex.id, name: ex.name, color: ex.color } as unknown as
        import('../../../lib/database.types').Exercise;
      mergeLogExercise(newLogEx, partial);
    });
  };

  const handleFinishSession = async () => {
    if (!data?.log?.session) return;
    await patchSession({
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    setMode('preview');
    // The chip row reads status from `overview` (a separate query), so
    // we need to refresh it here for the green check to appear without
    // a page revisit.
    await loadWeek();
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
      const savedSet = await upsertLoggedSet({
        logExerciseId,
        setNumber: patch.setNumber,
        plannedLoad: null,
        plannedReps: null,
        performedLoad: patch.performedLoad,
        performedReps: patch.performedReps,
        rpe: null,
        status: patch.status,
      });
      mergeLoggedSet(savedSet);
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
            {overview.planSource === 'group' && (
              <p className="text-[10px] text-gray-500 italic px-1">Showing your group's plan.</p>
            )}
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
            log={data.log}
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
              metricsConfig={data.metricsConfig}
              enabledMetricDefs={
                data.metricsConfig
                  ? data.metricDefinitions.filter(d =>
                      data.metricsConfig!.enabled_custom_metric_ids.includes(d.id),
                    )
                  : []
              }
              onPatchBodyweight={handlePatchBodyweight}
              onPatchRaw={handlePatchRaw}
              onPatchVas={handlePatchVas}
              onPatchCustomMetric={handlePatchCustomMetric}
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
                  const le = data.log?.exercises.find(e => e.log.planned_exercise_id === p.exercise.id);
                  const loggedExercise = le?.log ?? null;
                  const performed = le?.exercise ?? null;
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
                      onDeleteSet={handleDeleteSet}
                      onRemovePlannedSet={handleRemovePlannedSet(p)}
                      onSaveGppSection={handleSaveGppSection(p)}
                      onRequestSubstitute={() => setSubstituting(p)}
                      performedExercise={performed}
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
                  onDelete={() => handleDeleteOffPlanExercise(le.log.id)}
                  onDeleteSet={handleDeleteSet}
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

              {data.log?.session && (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 mt-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                    Messages
                  </div>
                  <AthleteCommentsThread
                    messages={(data.log.messages ?? []).filter(m => !m.exercise_id)}
                    onPost={handlePostComment}
                  />
                </div>
              )}

              {selectedOverviewDay?.isBonus && data.log?.session && (
                <button
                  onClick={handleDeleteBonusDay}
                  disabled={saving}
                  className="w-full inline-flex items-center justify-center gap-2 text-[11px] text-red-400 hover:text-red-300 hover:bg-red-950/40 py-2 rounded-xl mt-1 transition-colors"
                  title="Delete this entire bonus day"
                >
                  <Trash2 size={12} />
                  Delete training day
                </button>
              )}
            </div>
          </>
        ) : null}

        <ExercisePicker
          open={showPicker}
          onClose={() => setShowPicker(false)}
          onPick={handleAddOffPlanExercise}
        />
        <ExercisePicker
          open={substituting != null}
          onClose={() => setSubstituting(null)}
          onPick={async pick => {
            if (substituting) await handleSubstitute(substituting, pick);
          }}
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
