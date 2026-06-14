/**
 * LogModeView — coach-facing weekly Training Log.
 *
 * Renders the same week structure as the Plan mode (one block per visible
 * day) but pairs each planned exercise with what the athlete actually
 * did. P4 adds coach reply support: post comments to either the session
 * (whole day) or one exercise (inline thread).
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import type {
  PlannedExercise,
  Exercise,
  AthleteMetricDefinition,
  AthleteWeekMetricsConfig,
} from '../../../lib/database.types';
import {
  fetchWeekLog,
  addComment,
  deleteLogExercise,
  deleteSession,
  ensureLogExercise,
  setLogExerciseGppSection,
  fetchWeekMetricsConfig,
  fetchMetricDefinitions,
} from '../../../lib/trainingLogService';
import type { GppSection } from '../../../lib/database.types';
import type { DayLog, LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { LogDayCard } from './LogDayCard';
import { LogWeekOverview } from './LogWeekOverview';
import { CoachSetEditModal } from './CoachSetEditModal';
import { WeekMetricsSettings } from './WeekMetricsSettings';
import { ConfirmModal } from '../../log/ConfirmModal';
import { GppBlockEditor } from '../GppBlockEditor';
import { formatTime24 } from '../../../lib/dateUtils';
import { getShowAllWeekdays, setShowAllWeekdays } from '../../../lib/logViewPrefs';

interface LogModeViewProps {
  athleteId: string;
  weekStart: string;
  visibleDays: Array<{ index: number; name: string }>;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  /** day_labels from the week plan, used to label bonus athlete-added days. */
  dayLabels?: Record<number, string> | null;
  /** Day to auto-expand, scroll to and blink (deep-link from an activity). */
  highlightDayIndex?: number | null;
}

export function LogModeView({
  athleteId,
  weekStart,
  visibleDays,
  plannedExercises,
  dayLabels,
  highlightDayIndex,
}: LogModeViewProps) {
  const [weekLog, setWeekLog] = useState<Record<number, DayLog>>({});
  // Coach view preference (device-local): show all 7 weekdays vs only days
  // with a logged session in the overview's daily-metric tables.
  const [showAllWeekdays, setShowAllWeekdaysState] = useState<boolean>(() => getShowAllWeekdays());
  const onToggleAllWeekdays = useCallback((value: boolean) => {
    setShowAllWeekdaysState(value);
    setShowAllWeekdays(value);
  }, []);
  const [metricsConfig, setMetricsConfig] = useState<AthleteWeekMetricsConfig | null>(null);
  const [metricDefs, setMetricDefs] = useState<AthleteMetricDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [editingLogged, setEditingLogged] = useState<LoggedExerciseFull | null>(null);
  const [editingGpp, setEditingGpp] = useState<{
    planned: PlannedExercise & { exercise: Exercise };
    logged: LoggedExerciseFull | null;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    description?: string;
    confirmLabel: string;
    variant: 'default' | 'danger';
    onConfirm: () => Promise<void>;
  } | null>(null);

  /**
   * Canonical data-fetch function. AbortSignal propagated to all three
   * parallel fetches; if the component unmounts before all three resolve,
   * the cancelled guard prevents stale state writes. (UF-25 / I1)
   */
  const loadAll = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const [log, cfg, defs] = await Promise.all([
          fetchWeekLog(athleteId, weekStart),
          fetchWeekMetricsConfig(athleteId, weekStart),
          fetchMetricDefinitions(athleteId),
        ]);
        if (signal.aborted) return;
        setWeekLog(log);
        setMetricsConfig(cfg);
        setMetricDefs(defs);
        setLoadedAt(new Date());
      } catch (e) {
        if (signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [athleteId, weekStart],
  );

  /** Manual reload: used for settings changes and destructive mutations.
   *  Comment posts use optimistic-merge instead. */
  const reload = useCallback(() => {
    const ctrl = new AbortController();
    void loadAll(ctrl.signal);
  }, [loadAll]);

  /** Optimistically append a new message to a session's message list
   *  so the coach sees their comment immediately. (UF-25 / I1) */
  const appendMessage = useCallback(
    (msg: import('../../../lib/database.types').TrainingLogMessage) => {
      setWeekLog(prev => {
        const dayIndex = Object.keys(prev).find(k => {
          const day = prev[Number(k)];
          return day.session?.id === msg.session_id;
        });
        if (!dayIndex) return prev;
        const d = prev[Number(dayIndex)];
        return {
          ...prev,
          [Number(dayIndex)]: {
            ...d,
            messages: [...d.messages, msg],
          },
        };
      });
    },
    [],
  );

  const postSessionComment = useCallback(
    async (sessionId: string, body: string) => {
      const msg = await addComment({
        sessionId,
        exerciseId: null,
        message: body,
        senderType: 'coach',
      });
      appendMessage(msg);
    },
    [appendMessage],
  );

  const onDeleteLogExercise = useCallback(
    (logExerciseId: string) => {
      setPendingConfirm({
        title: 'Delete this logged exercise?',
        description: 'All sets for this exercise will also be removed.',
        confirmLabel: 'Delete',
        variant: 'danger',
        onConfirm: async () => {
          setPendingConfirm(null);
          await deleteLogExercise(logExerciseId);
          reload();
        },
      });
    },
    [reload],
  );

  /**
   * Save handler for the coach-side GPP editor. Ensures a log_exercise
   * exists (the athlete may never have opened the block), then writes
   * the full GppSection — rows, reps, load text, and done flags — to
   * training_log_exercises.metadata.gpp via the shared service helper.
   * Requires a session row for the day; without one we silently no-op.
   */
  const onSaveGppFromModal = useCallback(
    async (section: GppSection) => {
      if (!editingGpp) return;
      const { planned, logged } = editingGpp;
      const session = weekLog[planned.day_index]?.session;
      if (!session) return;
      const logEx =
        logged?.log ??
        (await ensureLogExercise({
          sessionId: session.id,
          plannedExerciseId: planned.id,
          exerciseId: planned.exercise_id,
          position: planned.position,
        }));
      await setLogExerciseGppSection(logEx.id, section);
      reload();
    },
    [editingGpp, weekLog, reload],
  );

  const onDeleteSession = useCallback(
    (sessionId: string) => {
      setPendingConfirm({
        title: 'Delete this entire session?',
        description: 'All logged exercises and messages for this day will be permanently removed. This cannot be undone.',
        confirmLabel: 'Delete session',
        variant: 'danger',
        onConfirm: async () => {
          setPendingConfirm(null);
          await deleteSession(sessionId);
          reload();
        },
      });
    },
    [reload],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void loadAll(ctrl.signal);
    return () => ctrl.abort();
  }, [loadAll]);

  const totalLogged = Object.values(weekLog).reduce(
    (sum, d) => sum + d.exercises.length, 0,
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="text-[11px] text-gray-500">
          {loading
            ? 'Loading log…'
            : error
            ? null
            : (
              <>
                {Object.keys(weekLog).length} day{Object.keys(weekLog).length === 1 ? '' : 's'} logged ·{' '}
                {totalLogged} exercise{totalLogged === 1 ? '' : 's'}
                {loadedAt && (
                  <span className="text-gray-400 ml-2">
                    · loaded {formatTime24(loadedAt, true)}
                  </span>
                )}
              </>
            )}
        </div>
        <div className="flex items-center gap-1">
          <WeekMetricsSettings
            athleteId={athleteId}
            weekStart={weekStart}
            onChange={reload}
            showAllWeekdays={showAllWeekdays}
            onShowAllWeekdaysChange={onToggleAllWeekdays}
          />
          <button
            onClick={reload}
            disabled={loading}
            className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-900 disabled:opacity-50 px-2 py-1 rounded hover:bg-gray-100"
            title="Refresh log data"
          >
            <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 px-3 py-2 border border-red-200 bg-red-50 rounded text-xs text-red-800">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Failed to load log data</div>
            <div className="text-red-700 mt-0.5 break-all">{error}</div>
          </div>
        </div>
      )}

      {!loading && !error && visibleDays.length === 0 && (
        <div className="px-3 py-8 text-center text-xs text-gray-400 italic">
          No active days in this week.
        </div>
      )}

      {!loading && !error && (visibleDays.length > 0 || Object.keys(weekLog).length > 0) && (
        <LogWeekOverview
          visibleDays={visibleDays}
          plannedExercises={plannedExercises}
          weekLog={weekLog}
          metricsConfig={metricsConfig}
          enabledMetricDefs={
            metricsConfig
              ? metricDefs.filter(d => metricsConfig.enabled_custom_metric_ids.includes(d.id))
              : []
          }
          showAllWeekdays={showAllWeekdays}
        />
      )}

      {!loading && !error && visibleDays.map(day => (
        <LogDayCard
          key={day.index}
          dayName={day.name}
          highlight={highlightDayIndex != null && day.index === highlightDayIndex}
          plannedExercises={plannedExercises[day.index] ?? []}
          dayLog={weekLog[day.index] ?? null}
          onPostSessionComment={postSessionComment}
          onDeleteLogExercise={onDeleteLogExercise}
          onDeleteSession={onDeleteSession}
          onEditLoggedExercise={setEditingLogged}
          onEditGppExercise={setEditingGpp}
        />
      ))}

      {/* Bonus athlete-added days: sessions whose day_index isn't in
          visibleDays. Labelled from day_labels when present, else
          falls back to "Extra N". Rendered under a separator. */}
      {!loading && !error && (() => {
        const visibleIndices = new Set(visibleDays.map(d => d.index));
        const extras = Object.keys(weekLog)
          .map(k => Number(k))
          .filter(idx => !visibleIndices.has(idx))
          .sort((a, b) => a - b);
        if (extras.length === 0) return null;
        return (
          <>
            <div className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 mt-3 mb-2 px-1">
              Added by athlete
            </div>
            {extras.map((idx, i) => {
              const label = dayLabels?.[idx]?.trim() || `Extra ${i + 1}`;
              return (
                <LogDayCard
                  key={`extra-${idx}`}
                  dayName={label}
                  highlight={highlightDayIndex != null && idx === highlightDayIndex}
                  plannedExercises={[]}
                  dayLog={weekLog[idx] ?? null}
                  onPostSessionComment={postSessionComment}
                  onEditGppExercise={setEditingGpp}
                />
              );
            })}
          </>
        );
      })()}

      {editingLogged && (
        <CoachSetEditModal
          open
          exerciseName={editingLogged.exercise?.name ?? '(unknown exercise)'}
          logExerciseId={editingLogged.log.id}
          loggedSets={editingLogged.sets}
          onClose={() => setEditingLogged(null)}
          onChanged={reload}
          plannedExercise={
            editingLogged.log.planned_exercise_id
              ? Object.values(plannedExercises)
                  .flat()
                  .find(p => p.id === editingLogged.log.planned_exercise_id) ?? null
              : null
          }
        />
      )}

      {editingGpp && (
        <GppBlockEditor
          open
          title="Edit GPP — athlete log"
          showDoneColumn
          initial={
            (editingGpp.logged?.log.metadata?.gpp as GppSection | undefined) ??
            editingGpp.planned.metadata?.gpp ??
            null
          }
          onClose={() => setEditingGpp(null)}
          onSave={onSaveGppFromModal}
        />
      )}

      <ConfirmModal
        open={pendingConfirm != null}
        title={pendingConfirm?.title ?? ''}
        description={pendingConfirm?.description}
        confirmLabel={pendingConfirm?.confirmLabel ?? 'Confirm'}
        variant={pendingConfirm?.variant ?? 'default'}
        onConfirm={() => { if (pendingConfirm) void pendingConfirm.onConfirm(); }}
        onCancel={() => setPendingConfirm(null)}
      />
    </div>
  );
}
