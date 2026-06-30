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
import { Loader2, Plus, CheckCircle, Eye, Trash2, Ban, RotateCcw } from 'lucide-react';
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
  setLogExerciseText,
  setSessionCustomMetric,
  setSubstitutedExercise,
  markMessagesRead,
  defaultSlotLabel,
  type AthleteDayData,
  type PlannedExerciseFull,
  type WeekOverview,
  type ExerciseSearchResult,
} from '../../../lib/trainingLogService';
import { getOrCreateSentinel } from '../../../components/planner/sentinelService';
import { getSentinelType } from '../../../components/planner/sentinelUtils';
import type {
  AthletePRHistory,
  CustomMetricEntry,
  ExerciseStub,
  GppSection,
  TrainingLogSession,
  TrainingLogSet,
} from '../../../lib/database.types';
import { isExerciseDone } from '../../../lib/trainingLogModel';
import { formatWeekday, formatTime24, combineDateTimeToISO } from '../../../lib/dateUtils';
import { expectedPlannedSetCount } from '../../../lib/plannedSetCount';
import { fetchPRHistory, insertPRHistory, syncAthletePRs } from '../../../lib/prTable';
import { estimateAtRepsFromAnchors, roundToHalf } from '../../../lib/xrmUtils';
import { SessionHeader } from '../components/SessionHeader';
import { SessionPreview } from '../components/SessionPreview';
import { ExerciseLogCard } from '../components/ExerciseLogCard';
import { OffPlanExerciseCard } from '../components/OffPlanExerciseCard';
import { OffPlanNoteCard } from '../components/OffPlanNoteCard';
import { GppLogCard } from '../components/GppLogCard';
import { ExercisePicker } from '../components/ExercisePicker';
import { AddTrainingSheet } from '../components/AddTrainingSheet';
import { NotDoneSheet } from '../components/NotDoneSheet';
import { AthleteCommentsThread } from '../components/AthleteCommentsThread';
import type { RawScores } from '../components/RawScoreDial';
import type { SetRowInput } from '../components/SetEntryRow';
import { WeekNavigator, getMondayOf, toISO } from '../components/WeekNavigator';
import { DayChipRow } from '../components/DayChipRow';
import { WeekBriefCard } from '../components/WeekBriefCard';
import { ConfirmModal } from '../../../components/log/ConfirmModal';
import { UndoToast } from '../../../components/log/UndoToast';

function todayISO(): string {
  return toISO(new Date());
}

/** Return today's weekday in DB convention: 0=Mon, 1=Tue, ..., 6=Sun.
 *  JS getDay() uses 0=Sun,1=Mon..6=Sat; (jsDay+6)%7 converts. (Q-13) */
function todayDayIndex(): number {
  return (new Date().getDay() + 6) % 7;
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
  // A deliberately not-done (skipped) day is "resolved", not unfinished, so
  // don't auto-open it — prefer the earliest day still awaiting work.
  const firstUnfinished = overview.days.find(
    d => d.status !== 'completed' && d.status !== 'skipped',
  );
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
  /** When true, the "mark session not done" reason sheet is open. */
  const [showNotDone, setShowNotDone] = useState(false);
  /** When set, the exercise picker opens in substitution mode for a
   *  specific planned exercise. */
  const [substituting, setSubstituting] = useState<PlannedExerciseFull | null>(null);

  // ─── Confirmation modal and undo-toast state (UF-12) ─────────────────────
  /** Pending destructive action awaiting in-app confirmation. */
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    description?: string;
    confirmLabel: string;
    variant: 'default' | 'danger';
    onConfirm: () => Promise<void>;
  } | null>(null);
  /** Pending single-set deletion awaiting undo window. The setId is the
   *  DB id; we hold it until the toast dismisses and then commit the delete. */
  const [pendingSetDelete, setPendingSetDelete] = useState<{
    setId: string;
    /** Optimistically-removed set so we can restore it on undo. */
    set: TrainingLogSet;
  } | null>(null);
  /**
   * 'preview' renders the session like the coach's print view, no
   * inputs. 'edit' is the full logging UI. Defaults to 'preview';
   * "Start logging" enters edit, and the user can switch back via
   * the eye toggle in SessionHeader.
   */
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');

  // ── PR detection ──────────────────────────────────────────────────────────
  // The athlete's full PR history (newest-first), so a freshly-logged set can
  // be compared against the current record at its rep count without a per-save
  // round-trip. Loaded once per athlete, kept in sync as PRs are registered.
  const [prHistory, setPrHistory] = useState<AthletePRHistory[]>([]);
  const [prPrompt, setPrPrompt] = useState<{
    exerciseId: string; exerciseName: string;
    repCount: number; valueKg: number; achievedDate: string;
    previous: number; isEstimate: boolean;
  } | null>(null);
  // Values the athlete declined this session, so we don't re-nag for the same
  // (exercise, reps, value) on every subsequent set save.
  const prDismissedRef = useRef<Set<string>>(new Set());
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

  // Keep a ref so loadDay can read the latest weekPlanId without being
  // in the dependency array (which would cause double-loads on overview change).
  const overviewRef = useRef<WeekOverview | null>(null);
  overviewRef.current = overview;

  const loadDay = useCallback(async () => {
    if (!athlete || dayIndex == null) {
      setData(null);
      return;
    }
    setLoadingDay(true);
    setError(null);
    try {
      // Pass the pre-resolved weekPlanId only when the cached overview is for
      // the week we are loading. On a week change loadWeek's fetch is still in
      // flight, so overviewRef holds the PREVIOUS week's plan id — using it
      // would reload the old week's day. When stale, pass undefined so
      // fetchAthleteDay resolves the correct plan from weekStart. (UF-44 / H4)
      const knownWeekPlanId =
        overviewRef.current?.weekStart === weekStart
          ? overviewRef.current.weekPlanId
          : undefined;
      const d = await fetchAthleteDay(
        athlete.id,
        weekStart,
        dayIndex,
        knownWeekPlanId,
      );
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDay(false);
    }
  }, [athlete, weekStart, dayIndex]);

  useEffect(() => { void loadWeek(); }, [loadWeek]);
  useEffect(() => { void loadDay(); }, [loadDay]);

  // Mark all session messages read when athlete enters edit mode. (UF-10 / E3)
  useEffect(() => {
    if (mode !== 'edit') return;
    const sessionId = data?.log?.session?.id;
    if (!sessionId) return;
    // Fire-and-forget: read tracking is best-effort; errors are non-fatal.
    markMessagesRead(sessionId, null, 'athlete').catch(() => undefined);
  }, [mode, data?.log?.session?.id]);

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

  const offPlanLogged = useMemo(
    () => (data?.log?.exercises ?? []).filter(le => !le.log.planned_exercise_id),
    [data],
  );

  if (!athlete) return null;

  // ─── Mutation helpers ────────────────────────────────────────────────────

  const performedOnDate =
    data?.log?.session?.date ?? todayISO();

  // Time of day the training was performed. Reuses session.started_at (stamped
  // to now() when the session is first created on the first set edit). Until a
  // session exists, default to the current time so the input shows a sensible
  // value; nothing is persisted until the athlete logs something.
  const performedAtTime = data?.log?.session?.started_at
    ? formatTime24(data.log.session.started_at)
    : formatTime24(new Date());

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
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      // Only reload day state when the error might indicate a stale or
      // inconsistent server state. Network-level failures (no connectivity,
      // request aborted) do not invalidate local state, so skip the reload
      // to avoid a second failure spinning the loading indicator. (E-21)
      const isTransient =
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('network') ||
        msg.includes('AbortError');
      if (!isTransient) {
        await loadDay();
      }
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
    // Keep `date` (the calendar day, used for week grouping) and `started_at`
    // (the precise performed-at instant) coherent: shift the timestamp to the
    // new day while preserving the time of day.
    await patchSession({
      date: next,
      started_at: combineDateTimeToISO(next, performedAtTime),
    });
  };

  const handlePatchPerformedAt = async (next: string) => {
    if (next === performedAtTime) return;
    await patchSession({ started_at: combineDateTimeToISO(performedOnDate, next) });
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
    // Accepts an ExerciseStub for the optimistic-add path: addOffPlanLogExercise
    // returns id/name/color only; the full Exercise lands on the next reload.
    exerciseDef:
      | import('../../../lib/database.types').Exercise
      | import('../../../lib/database.types').ExerciseStub
      | null,
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

  // Load the athlete's PR history once per athlete (newest-first).
  const athleteId = athlete?.id ?? null;
  useEffect(() => {
    if (!athleteId) { setPrHistory([]); return; }
    let cancelled = false;
    fetchPRHistory(athleteId)
      .then(h => { if (!cancelled) setPrHistory(h); })
      .catch(() => { /* PR prompt is best-effort; ignore load failures */ });
    return () => { cancelled = true; };
  }, [athleteId]);

  /**
   * After a set is saved, decide whether it would be a new PR at its rep count
   * and, if so, surface the register-PR prompt. Best-effort and limited to
   * quantified single lifts (not combos), a positive kg load, a whole rep
   * count in 1–10, and a completed set.
   *
   * The bar is the same the PR table shows: the current record at that rep
   * count if one exists, otherwise the value ESTIMATED at that rep count from
   * the athlete's other PRs (same multi-anchor model as buildPRRows). So a
   * logged xRM above the estimate also prompts. Only an exercise with no PRs
   * at all has no bar and stays silent.
   */
  const checkForPR = useCallback((args: {
    exerciseId: string | null | undefined;
    exerciseName: string | null | undefined;
    isCombo: boolean;
    repCount: number | null;
    valueKg: number | null;
    status: string;
    achievedDate: string;
  }) => {
    const { exerciseId, exerciseName, isCombo, repCount, valueKg, status, achievedDate } = args;
    if (status !== 'completed' || isCombo || !exerciseId) return;
    if (valueKg == null || !Number.isFinite(valueKg) || valueKg <= 0) return;
    if (repCount == null || !Number.isInteger(repCount) || repCount < 1 || repCount > 10) return;

    // Current record per rep count (prHistory is newest-first, so the first
    // match is the current value) — the table's "current" semantics.
    const currentByRep = new Map<number, number>();
    for (const h of prHistory) {
      if (h.exercise_id !== exerciseId || h.rep_count < 1 || h.rep_count > 10) continue;
      if (!currentByRep.has(h.rep_count)) currentByRep.set(h.rep_count, h.value_kg);
    }

    const realAtRep = currentByRep.get(repCount);
    let threshold: number;
    let isEstimate: boolean;
    if (realAtRep != null) {
      threshold = realAtRep;
      isEstimate = false;
    } else {
      const anchors = Array.from(currentByRep, ([reps, valueKg]) => ({ reps, valueKg }));
      if (anchors.length === 0) return;            // no PRs at all → no bar
      threshold = roundToHalf(estimateAtRepsFromAnchors(anchors, repCount));
      isEstimate = true;
    }
    if (!(valueKg > threshold)) return;

    const key = `${exerciseId}:${repCount}:${valueKg}`;
    if (prDismissedRef.current.has(key)) return;
    setPrPrompt({
      exerciseId,
      exerciseName: exerciseName ?? 'this lift',
      repCount,
      valueKg,
      achievedDate,
      previous: threshold,
      isEstimate,
    });
  }, [prHistory]);

  const handleRegisterPR = () => {
    if (!prPrompt || !athlete) return;
    const { exerciseId, repCount, valueKg, achievedDate } = prPrompt;
    setPrPrompt(null);
    void runSave(async () => {
      const entry = await insertPRHistory({
        athleteId: athlete.id,
        exerciseId,
        repCount,
        valueKg,
        achievedDate,
      });
      await syncAthletePRs(athlete.id, exerciseId);
      // Prepend so it becomes the current record for subsequent checks.
      setPrHistory(prev => [entry, ...prev]);
    });
  };

  const dismissPRPrompt = () => {
    if (prPrompt) {
      prDismissedRef.current.add(`${prPrompt.exerciseId}:${prPrompt.repCount}:${prPrompt.valueKg}`);
    }
    setPrPrompt(null);
  };

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
        performedText: patch.performedText ?? null,
        rpe: null,
        status: patch.status,
      });
      mergeLoggedSet(savedSet);
      // Auto-promote exercise to 'completed' when all planned sets reach
      // a terminal state. Build the projected set list from current data
      // and the newly-saved set to avoid stale-closure issues. (UF-02)
      const currentSets = data?.log?.exercises.find(e => e.log.id === logEx.id)?.sets ?? [];
      const mergedSets = (() => {
        const idx = currentSets.findIndex(s => s.id === savedSet.id);
        return idx >= 0
          ? currentSets.map(s => (s.id === savedSet.id ? savedSet : s))
          : [...currentSets, savedSet].sort((a, b) => a.set_number - b.set_number);
      })();
      const currentLogEx = data?.log?.exercises.find(e => e.log.id === logEx.id);
      if (currentLogEx && currentLogEx.log.status !== 'completed') {
        const projectedLe = { ...currentLogEx, sets: mergedSets };
        const plannedCount = expectedPlannedSetCount(planned);
        if (isExerciseDone(projectedLe, plannedCount)) {
          const promoted = await updateLogExercise(logEx.id, {
            status: 'completed',
            completed_at: new Date().toISOString(),
            started_at: currentLogEx.log.started_at ?? new Date().toISOString(),
          });
          mergeLogExercise(promoted, planned.exerciseDef);
        }
      }
      // PR prompt: compare against the actually-performed exercise (honours a
      // substitution) and the session's performed-on date.
      const performedDef = data?.log?.exercises
        .find(e => e.log.planned_exercise_id === planned.exercise.id)?.exercise;
      const prEx = performedDef ?? planned.exerciseDef;
      checkForPR({
        exerciseId: prEx?.id,
        exerciseName: prEx?.name,
        isCombo: planned.exercise.is_combo,
        repCount: patch.performedReps,
        valueKg: patch.performedLoad,
        status: patch.status,
        achievedDate: session.date,
      });
    });

  const handleLogAsPrescribed = (planned: PlannedExerciseFull) => (rows: SetRowInput[]) =>
    runSave(async () => {
      // Safety net for "Log as prescribed". The button is gated in the
      // card to only render when unit === 'absolute_kg' and every row
      // has a numeric plannedLoadValue, but if the saver is invoked
      // some other way (stale call, future caller), refuse to copy a
      // null planned load over the athlete's data — that's exactly
      // what produced the "?/<reps>" wipe Asger hit.
      if (planned.exercise.unit !== 'absolute_kg' || rows.some(r => r.plannedLoadValue == null)) {
        return;
      }
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

  const handleUpdateOffPlanNotes = (logExerciseId: string) => (notes: string) =>
    runSave(async () => {
      const updated = await updateLogExercise(logExerciseId, { performed_notes: notes });
      setData(prev => {
        if (!prev?.log) return prev;
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.map(e =>
              e.log.id === updated.id ? { ...e, log: updated } : e,
            ),
          },
        };
      });
    });

  const handleDeleteSet = (setId: string) => {
    // Find the set so we can restore it on undo.
    const setRow = data?.log?.exercises
      .flatMap(le => le.sets)
      .find(s => s.id === setId);
    if (!setRow) return;
    // The pending-delete buffer holds ONE set. If a previous delete is
    // still inside its undo window, commit it now before we overwrite the
    // buffer — otherwise that earlier set vanishes from the UI but its DB
    // row is never deleted and resurrects on the next reload. (ATHLETE-ROBUSTNESS-1)
    if (pendingSetDelete && pendingSetDelete.setId !== setId) {
      const prevId = pendingSetDelete.setId;
      void runSave(async () => {
        await deleteLoggedSet(prevId);
      });
    }
    // Optimistically remove from UI immediately.
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
    setPendingSetDelete({ setId, set: setRow });
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
  const handleRemovePlannedSet = (planned: PlannedExerciseFull) => (setNumber: number) => {
    setPendingConfirm({
      title: 'Remove this set?',
      description: 'The set will be hidden from your plan for this session.',
      confirmLabel: 'Remove',
      variant: 'default',
      onConfirm: async () => {
        setPendingConfirm(null);
        await runSave(async () => {
          const session = await getOrCreateSession();
          mergeSession(session);
          const logEx = await ensureLogEx(planned, session.id);
          mergeLogExercise(logEx, planned.exerciseDef);
          const updated = await removePlannedSet(logEx.id, setNumber);
          mergeLogExercise(updated, planned.exerciseDef);
        });
      },
    });
  };

  const handleDeleteOffPlanExercise = (logExerciseId: string) => {
    setPendingConfirm({
      title: 'Remove this exercise?',
      description: 'This will remove the exercise and all its logged sets.',
      confirmLabel: 'Remove',
      variant: 'danger',
      onConfirm: async () => {
        setPendingConfirm(null);
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
      },
    });
  };

  const handleDeleteBonusDay = () => {
    if (!data?.log?.session) return;
    const sessionId = data.log.session.id;
    setPendingConfirm({
      title: 'Delete this training day?',
      description: 'All logged exercises and sets for this day will be permanently removed. This cannot be undone.',
      confirmLabel: 'Delete day',
      variant: 'danger',
      onConfirm: async () => {
        setPendingConfirm(null);
        await runSave(async () => {
          await deleteSession(sessionId);
          await loadWeek();
          setDayIndex(prev =>
            overview?.days.find(d => d.dayIndex !== prev)?.dayIndex ?? null,
          );
          setMode('preview');
        });
      },
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
        const partial: ExerciseStub = { id: pick.id, name: pick.name, color: pick.color };
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

  const handleAddOffPlanExercise = async (ex: ExerciseSearchResult) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const newLogEx = await addOffPlanLogExercise({
        sessionId: session.id,
        exerciseId: ex.id,
      });
      // Carry exercise_code + counts_towards_totals on the stub so the card
      // routes correctly and the week totals gate is right before reload.
      const partial: ExerciseStub = {
        id: ex.id,
        name: ex.name,
        color: ex.color,
        exercise_code: ex.exercise_code,
        counts_towards_totals: ex.counts_towards_totals,
      };
      mergeLogExercise(newLogEx, partial);
    });
  };

  /** Athlete-authored combination: one off-plan log row whose lead
   *  exercise_id is the first member; the full member list, name and ribbon
   *  colour live on metadata.combo (the log schema has no combo table). */
  const handleAddOffPlanCombo = async (payload: {
    members: ExerciseSearchResult[];
    name: string | null;
  }) => {
    await runSave(async () => {
      if (payload.members.length < 2) return;
      const session = await getOrCreateSession();
      mergeSession(session);
      const lead = payload.members[0];
      const comboColor = '#8B5CF6';
      const metadata = {
        combo: {
          name: payload.name,
          color: comboColor,
          members: payload.members.map((m, i) => ({
            exerciseId: m.id,
            name: m.name,
            color: m.color,
            position: i + 1,
          })),
        },
      };
      const newLogEx = await addOffPlanLogExercise({
        sessionId: session.id,
        exerciseId: lead.id,
        metadata,
      });
      const stub: ExerciseStub = {
        id: lead.id,
        name: payload.name?.trim() || payload.members.map(m => m.name).join(' + '),
        color: comboColor,
        exercise_code: null,
        // Performed tonnage attributes the combo to its lead exercise, so the
        // lead's flag decides whether it counts (same as planned combos).
        counts_towards_totals: lead.counts_towards_totals,
      };
      mergeLogExercise(newLogEx, stub);
    });
  };

  /** Athlete-authored free-text note (TEXT sentinel). Body persists into
   *  metadata.text at creation so the card shows it immediately. */
  const handleAddOffPlanNote = async (text: string) => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const sentinel = await getOrCreateSentinel('TEXT', athlete.owner_id);
      if (!sentinel) throw new Error('Could not create note');
      const newLogEx = await addOffPlanLogExercise({
        sessionId: session.id,
        exerciseId: sentinel.id,
        ...(text ? { metadata: { text } } : {}),
      });
      const stub: ExerciseStub = {
        id: sentinel.id,
        name: 'Note',
        color: '#9CA3AF',
        exercise_code: 'TEXT',
        counts_towards_totals: false,
      };
      mergeLogExercise(newLogEx, stub);
    });
  };

  /** Athlete-authored GPP block (GPP sentinel). Created empty; the athlete
   *  fills rows in the card, persisted via metadata.gpp. */
  const handleAddOffPlanGpp = async () => {
    await runSave(async () => {
      const session = await getOrCreateSession();
      mergeSession(session);
      const sentinel = await getOrCreateSentinel('GPP', athlete.owner_id);
      if (!sentinel) throw new Error('Could not create GPP block');
      const newLogEx = await addOffPlanLogExercise({
        sessionId: session.id,
        exerciseId: sentinel.id,
      });
      const stub: ExerciseStub = {
        id: sentinel.id,
        name: 'GPP',
        color: '#10B981',
        exercise_code: 'GPP',
        counts_towards_totals: false,
      };
      mergeLogExercise(newLogEx, stub);
    });
  };

  /** Persist a note body on an off-plan TEXT row (metadata.text). */
  const handleUpdateOffPlanText = (logExerciseId: string) => (text: string) =>
    runSave(async () => {
      const updated = await setLogExerciseText(logExerciseId, text);
      setData(prev => {
        if (!prev?.log) return prev;
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.map(e =>
              e.log.id === updated.id ? { ...e, log: updated } : e,
            ),
          },
        };
      });
    });

  /** Persist GPP rows on an off-plan GPP row (metadata.gpp). The log row
   *  already exists, so no ensureLogExercise is needed. */
  const handleSaveOffPlanGppSection = (logExerciseId: string) => async (section: GppSection) => {
    await runSave(async () => {
      const updated = await setLogExerciseGppSection(logExerciseId, section);
      setData(prev => {
        if (!prev?.log) return prev;
        return {
          ...prev,
          log: {
            ...prev.log,
            exercises: prev.log.exercises.map(e =>
              e.log.id === updated.id ? { ...e, log: updated } : e,
            ),
          },
        };
      });
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

  /**
   * Mark the whole session "not done" with a reason (sick, injured, …).
   * patchSession creates the session first if none exists yet, so a day the
   * athlete never started can still be marked. The planned exercises stay in
   * the log — this only sets the session status + reason, never deletes work.
   */
  const handleMarkNotDone = async (reason: string) => {
    await patchSession({ status: 'skipped', skipped_reason: reason });
    setMode('preview');
    await loadWeek();
  };

  /** Undo a "not done" mark: return the session to a normal pending state and
   *  clear the reason so the athlete can log it after all. */
  const handleReopenSession = async () => {
    await patchSession({ status: 'pending', skipped_reason: null, completed_at: null });
    await loadWeek();
  };

  const handleSaveOffPlanSet = (logExerciseId: string) => (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
    performedText?: string | null;
  }) =>
    runSave(async () => {
      const savedSet = await upsertLoggedSet({
        logExerciseId,
        setNumber: patch.setNumber,
        plannedLoad: null,
        plannedReps: null,
        performedLoad: patch.performedLoad,
        performedReps: patch.performedReps,
        performedText: patch.performedText ?? null,
        rpe: null,
        status: patch.status,
      });
      mergeLoggedSet(savedSet);
      // PR prompt for off-plan logging (off-plan exercises are never combos).
      const offPlanEx = data?.log?.exercises.find(e => e.log.id === logExerciseId)?.exercise;
      checkForPR({
        exerciseId: offPlanEx?.id,
        exerciseName: offPlanEx?.name,
        isCombo: false,
        repCount: patch.performedReps,
        valueKg: patch.performedLoad,
        status: patch.status,
        achievedDate: data?.log?.session?.date ?? todayISO(),
      });
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
              disabled={saving}
            />
            {overview.planSource === 'group' && (
              <p className="text-[10px] text-gray-500 italic px-1">Showing your group's plan.</p>
            )}
            <WeekBriefCard brief={overview.weekBrief} />
          </>
        ) : null}

        {error && (
          <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
            <div className="font-semibold">Failed to load</div>
            <div className="mt-1 break-all">{error}</div>
          </div>
        )}

        {/* Subtle "refreshing" badge when loadDay re-runs while we still
         *  have data for the current day. Without this, runSave's
         *  fallback loadDay() used to unmount every log card during the
         *  refetch — destroying optimistic state on the GPP card (Done
         *  toggle), in-flight Set inputs, and untyped notes textareas.
         *  The badge keeps the cards mounted and just signals work in
         *  flight. */}
        {loadingDay && data && data.dayIndex === dayIndex && (
          <div className="flex items-center justify-center text-[10px] text-gray-500">
            <Loader2 size={11} className="animate-spin mr-1" />
            Refreshing…
          </div>
        )}

        {(!data || data.dayIndex !== dayIndex) && loadingDay ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 size={18} className="animate-spin mr-2" />
            <span className="text-sm">Loading session…</span>
          </div>
        ) : data && dayIndex != null && mode === 'preview' ? (
          <SessionPreview
            slotLabel={selectedOverviewDay?.label ?? defaultSlotLabel(dayIndex)}
            weekdayLabel={
              selectedOverviewDay?.weekday != null
                ? formatWeekday(performedOnDate, 'short')
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
            <div className="flex justify-end">
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
              slotLabel={selectedOverviewDay?.label ?? defaultSlotLabel(dayIndex)}
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
              performedOnDate={performedOnDate}
              performedAtTime={performedAtTime}
              sessionExists={!!data.log?.session}
              onPatchPerformedOn={handlePatchPerformedOn}
              onPatchPerformedAt={handlePatchPerformedAt}
            />

            <div className="space-y-2">
              {data.planned.length === 0 && offPlanLogged.length === 0 ? (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
                  <p className="text-sm text-gray-400">No exercises yet.</p>
                  <p className="text-xs text-gray-500 mt-1">Tap "Add training" to log what you did.</p>
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
                      loggedSets={le?.sets ?? []}
                      onSaveSet={handleSaveSet(p)}
                      onLogAsPrescribed={handleLogAsPrescribed(p)}
                      onUpdateNotes={handleUpdateExerciseNotes(p)}
                      onMarkComplete={handleMarkComplete(p)}
                      onDeleteSet={handleDeleteSet}
                      onRemovePlannedSet={handleRemovePlannedSet(p)}
                      onSaveGppSection={handleSaveGppSection(p)}
                      onRequestSubstitute={() => setSubstituting(p)}
                      performedExercise={performed}
                      globalSaving={saving}
                    />
                  );
                })
              )}

              {offPlanLogged.map(le => {
                // Route athlete-authored off-plan entries by kind. Sentinel
                // rows (TEXT / GPP) render their dedicated cards; everything
                // else (plain exercise or combo) uses OffPlanExerciseCard,
                // which reads metadata.combo to show a combination.
                const sentinel = getSentinelType(le.exercise?.exercise_code ?? null);
                if (sentinel === 'text') {
                  return (
                    <OffPlanNoteCard
                      key={le.log.id}
                      logExercise={le.log}
                      onUpdateText={handleUpdateOffPlanText(le.log.id)}
                      onDelete={() => handleDeleteOffPlanExercise(le.log.id)}
                    />
                  );
                }
                if (sentinel === 'gpp') {
                  return (
                    <GppLogCard
                      key={le.log.id}
                      planned={null}
                      authored
                      loggedExercise={le.log}
                      onSave={handleSaveOffPlanGppSection(le.log.id)}
                      onUpdateNotes={handleUpdateOffPlanNotes(le.log.id)}
                      onDelete={() => handleDeleteOffPlanExercise(le.log.id)}
                    />
                  );
                }
                return (
                  <OffPlanExerciseCard
                    key={le.log.id}
                    logExercise={le.log}
                    exercise={le.exercise}
                    loggedSets={le.sets}
                    onSaveSet={handleSaveOffPlanSet(le.log.id)}
                    onDelete={() => handleDeleteOffPlanExercise(le.log.id)}
                    onDeleteSet={handleDeleteSet}
                    onUpdateNotes={handleUpdateOffPlanNotes(le.log.id)}
                  />
                );
              })}

              <button
                onClick={() => setShowPicker(true)}
                className="w-full inline-flex items-center justify-center gap-2 text-xs text-gray-400 hover:text-white py-2.5 border border-dashed border-gray-700 hover:border-gray-500 rounded-xl"
              >
                <Plus size={14} />
                Add training
              </button>

              {data.log?.session?.status === 'skipped' ? (
                <div className="rounded-xl bg-red-950/40 border border-red-900/60 px-3 py-3 mt-2">
                  <div className="flex items-start gap-2">
                    <Ban size={15} className="text-red-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-red-200">Marked not done</div>
                      {data.log.session.skipped_reason?.trim() && (
                        <div className="text-[11px] text-red-300/90 mt-0.5 whitespace-pre-wrap break-words">
                          {data.log.session.skipped_reason}
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => void handleReopenSession()}
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-gray-300 hover:text-white py-2 mt-2 rounded-lg border border-gray-700 hover:border-gray-500 disabled:opacity-50 transition-colors"
                  >
                    <RotateCcw size={12} />
                    Reopen &amp; log it
                  </button>
                </div>
              ) : data.log?.session?.status === 'completed' ? (
                <div className="text-center text-[11px] text-emerald-400 italic mt-1">
                  Session marked complete · you can keep editing if you missed something
                </div>
              ) : (
                <div className="space-y-2 mt-2">
                  {data.log?.session && (
                    <button
                      onClick={handleFinishSession}
                      disabled={saving}
                      className="w-full inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
                    >
                      <CheckCircle size={16} />
                      Finish session
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotDone(true)}
                    disabled={saving}
                    className="w-full inline-flex items-center justify-center gap-1.5 text-[11px] text-gray-400 hover:text-red-300 py-2 rounded-xl border border-gray-800 hover:border-red-900/60 disabled:opacity-50 transition-colors"
                  >
                    <Ban size={12} />
                    Couldn't train? Mark not done
                  </button>
                </div>
              )}

              {data.log?.session && (
                <div className="rounded-xl bg-gray-900 border border-gray-800 p-3 mt-2">
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-2">
                    Session messages
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

        <AddTrainingSheet
          open={showPicker}
          onClose={() => setShowPicker(false)}
          onAddExercise={handleAddOffPlanExercise}
          onAddCombo={handleAddOffPlanCombo}
          onAddNote={handleAddOffPlanNote}
          onAddGpp={handleAddOffPlanGpp}
        />
        <NotDoneSheet
          open={showNotDone}
          defaultReason={data?.log?.session?.skipped_reason ?? ''}
          onClose={() => setShowNotDone(false)}
          onConfirm={handleMarkNotDone}
        />
        <ExercisePicker
          open={substituting != null}
          onClose={() => setSubstituting(null)}
          onPick={async pick => {
            if (substituting) await handleSubstitute(substituting, pick);
          }}
        />

        {/* In-app confirmation modal — replaces window.confirm (UF-12) */}
        <ConfirmModal
          open={pendingConfirm != null}
          title={pendingConfirm?.title ?? ''}
          description={pendingConfirm?.description}
          confirmLabel={pendingConfirm?.confirmLabel ?? 'Confirm'}
          variant={pendingConfirm?.variant ?? 'default'}
          onConfirm={() => { if (pendingConfirm) void pendingConfirm.onConfirm(); }}
          onCancel={() => setPendingConfirm(null)}
        />

        {/* New-PR prompt: a logged set that beats the current record at its
            rep count. Confirm registers it (and overwrites the current PR). */}
        <ConfirmModal
          open={prPrompt != null}
          title={prPrompt ? `New PR — ${prPrompt.exerciseName}` : ''}
          description={prPrompt
            ? (prPrompt.isEstimate
              ? `You lifted ${prPrompt.valueKg} kg × ${prPrompt.repCount}, above your estimated ${prPrompt.repCount}RM of ~${prPrompt.previous} kg. Register it as your ${prPrompt.repCount}RM?`
              : `You lifted ${prPrompt.valueKg} kg × ${prPrompt.repCount}, beating your current ${prPrompt.repCount}RM of ${prPrompt.previous} kg. Register it as your new ${prPrompt.repCount}RM?`)
            : undefined}
          confirmLabel="Register PR"
          cancelLabel="Not now"
          onConfirm={handleRegisterPR}
          onCancel={dismissPRPrompt}
        />

        {/* Undo toast for low-risk single-set delete (UF-12) */}
        <UndoToast
          message="Set removed"
          visible={pendingSetDelete != null}
          resetKey={pendingSetDelete?.setId ?? null}
          onUndo={() => {
            if (!pendingSetDelete) return;
            // Restore the set optimistically.
            const restored = pendingSetDelete.set;
            setData(prev => {
              if (!prev?.log) return prev;
              return {
                ...prev,
                log: {
                  ...prev.log,
                  exercises: prev.log.exercises.map(le => {
                    if (le.log.id !== restored.log_exercise_id) return le;
                    const already = le.sets.find(s => s.id === restored.id);
                    if (already) return le;
                    return {
                      ...le,
                      sets: [...le.sets, restored].sort((a, b) => a.set_number - b.set_number),
                    };
                  }),
                },
              };
            });
            setPendingSetDelete(null);
          }}
          onDismiss={() => {
            if (!pendingSetDelete) return;
            const { setId } = pendingSetDelete;
            setPendingSetDelete(null);
            // Commit the deletion now that the undo window has closed.
            void runSave(async () => {
              await deleteLoggedSet(setId);
            });
          }}
        />
    </div>
  );
}
