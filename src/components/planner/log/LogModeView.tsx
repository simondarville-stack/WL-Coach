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
import type { PlannedExercise, Exercise } from '../../../lib/database.types';
import {
  fetchWeekLog,
  addComment,
  deleteLogExercise,
  deleteSession,
} from '../../../lib/trainingLogService';
import type { DayLog, LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { LogDayCard } from './LogDayCard';
import { LogWeekOverview } from './LogWeekOverview';
import { CoachSetEditModal } from './CoachSetEditModal';

interface LogModeViewProps {
  athleteId: string;
  weekStart: string;
  visibleDays: Array<{ index: number; name: string }>;
  plannedExercises: Record<number, (PlannedExercise & { exercise: Exercise })[]>;
  /** day_labels from the week plan, used to label bonus athlete-added days. */
  dayLabels?: Record<number, string> | null;
}

export function LogModeView({
  athleteId,
  weekStart,
  visibleDays,
  plannedExercises,
  dayLabels,
}: LogModeViewProps) {
  const [weekLog, setWeekLog] = useState<Record<number, DayLog>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [editingLogged, setEditingLogged] = useState<LoggedExerciseFull | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchWeekLog(athleteId, weekStart)
      .then(data => {
        setWeekLog(data);
        setLoadedAt(new Date());
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [athleteId, weekStart]);

  const postSessionComment = useCallback(
    async (sessionId: string, body: string) => {
      await addComment({
        sessionId,
        exerciseId: null,
        message: body,
        senderType: 'coach',
      });
      reload();
    },
    [reload],
  );

  const postExerciseComment = useCallback(
    async (sessionId: string, logExerciseId: string, body: string) => {
      await addComment({
        sessionId,
        exerciseId: logExerciseId,
        message: body,
        senderType: 'coach',
      });
      reload();
    },
    [reload],
  );

  const onDeleteLogExercise = useCallback(
    async (logExerciseId: string) => {
      if (!window.confirm('Delete this logged exercise and all its sets?')) return;
      await deleteLogExercise(logExerciseId);
      reload();
    },
    [reload],
  );

  const onDeleteSession = useCallback(
    async (sessionId: string) => {
      if (
        !window.confirm(
          'Delete this entire session, including all logged exercises and messages? This cannot be undone.',
        )
      )
        return;
      await deleteSession(sessionId);
      reload();
    },
    [reload],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWeekLog(athleteId, weekStart)
      .then(data => {
        if (cancelled) return;
        setWeekLog(data);
        setLoadedAt(new Date());
      })
      .catch(e => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [athleteId, weekStart]);

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
                    · loaded {loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </>
            )}
        </div>
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
        />
      )}

      {!loading && !error && visibleDays.map(day => (
        <LogDayCard
          key={day.index}
          dayName={day.name}
          plannedExercises={plannedExercises[day.index] ?? []}
          dayLog={weekLog[day.index] ?? null}
          onPostSessionComment={postSessionComment}
          onPostExerciseComment={postExerciseComment}
          onDeleteLogExercise={onDeleteLogExercise}
          onDeleteSession={onDeleteSession}
          onEditLoggedExercise={setEditingLogged}
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
                  plannedExercises={[]}
                  dayLog={weekLog[idx] ?? null}
                  onPostSessionComment={postSessionComment}
                  onPostExerciseComment={postExerciseComment}
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
        />
      )}
    </div>
  );
}
