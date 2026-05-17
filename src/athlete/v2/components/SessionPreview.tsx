/**
 * SessionPreview — read-only "day overview" mirroring the coach Log view.
 *
 * Shows, for each planned exercise, what was planned (stacked notation)
 * and what was actually logged (stacked notation from training_log_sets).
 * Off-plan additions appear under "Added by you", same shape as the
 * coach's "Added by athlete" section. Sentinel free-text blocks render
 * their notes verbatim.
 *
 * Reads the shared StackedNotation / LoggedStackedNotation components
 * so the visual is identical to the coach side (different theme tokens).
 * "Start logging" enters edit mode.
 */
import { PlayCircle, CheckCircle2 } from 'lucide-react';
import type { PlannedExercise, Exercise, TrainingLogSet } from '../../../lib/database.types';
import type { PlannedExerciseFull } from '../../../lib/trainingLogService';
import type { DayLog, LoggedExerciseFull } from '../../../lib/trainingLogModel';
import { computeDelta, sumPerformedReps } from '../../../lib/trainingLogModel';
import { StackedNotation, LoggedStackedNotation } from '../../../components/planner/StackedNotation';
import { getSentinelType } from '../../../components/planner/plannerUtils';

interface SessionPreviewProps {
  slotLabel: string;
  weekdayLabel: string | null;
  date: string;
  planned: PlannedExerciseFull[];
  log: DayLog | null;
  onStart: () => void;
  isBonus?: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Not started',
  in_progress: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-gray-800 text-gray-400',
  in_progress: 'bg-amber-900/50 text-amber-300',
  completed: 'bg-emerald-900/50 text-emerald-300',
  skipped: 'bg-red-900/50 text-red-300',
};

export function SessionPreview({
  slotLabel,
  weekdayLabel,
  date,
  planned,
  log,
  onStart,
  isBonus,
}: SessionPreviewProps) {
  const prettyDate = new Date(date + 'T00:00:00').toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const session = log?.session ?? null;
  const status = session?.status ?? 'pending';

  // Split logged exercises by planned link
  const loggedByPlannedId = new Map<string, LoggedExerciseFull>();
  const offPlan: LoggedExerciseFull[] = [];
  (log?.exercises ?? []).forEach(le => {
    if (le.log.planned_exercise_id) loggedByPlannedId.set(le.log.planned_exercise_id, le);
    else offPlan.push(le);
  });

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-gray-900 border border-gray-800 px-4 py-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h2 className="text-base font-bold text-white">{slotLabel}</h2>
              {weekdayLabel && (
                <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  {weekdayLabel}
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-500 mt-0.5">{prettyDate}</p>
            {isBonus && (
              <p className="text-[10px] text-amber-300 italic mt-1">Extra training day</p>
            )}
          </div>
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${STATUS_CLASS[status] ?? STATUS_CLASS.pending}`}>
            {STATUS_LABEL[status] ?? status}
          </span>
        </div>

        {session && (
          <div className="flex items-center gap-3 text-[11px] text-gray-400 flex-wrap mt-2 pt-2 border-t border-gray-800/60">
            {session.bodyweight_kg != null && (
              <span><span className="text-gray-500">BW</span> {session.bodyweight_kg.toFixed(1)} kg</span>
            )}
            {session.raw_total != null && (
              <span><span className="text-gray-500">RAW</span> {session.raw_total}/12</span>
            )}
            {session.duration_minutes != null && (
              <span><span className="text-gray-500">⏱</span> {session.duration_minutes}m</span>
            )}
          </div>
        )}

        {session?.session_notes?.trim() && (
          <p className="text-[11px] text-gray-300 italic mt-2 pt-2 border-t border-gray-800/60 whitespace-pre-wrap">
            {session.session_notes}
          </p>
        )}
      </div>

      {planned.length === 0 && offPlan.length === 0 ? (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-6 text-center">
          <p className="text-sm text-gray-300 font-semibold">
            {isBonus ? 'Nothing logged yet' : 'No exercises in this slot'}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {isBonus
              ? 'Tap "Start logging" to add what you did.'
              : 'Pick another day or check with your coach.'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
          <ul className="divide-y divide-gray-800/60">
            {planned.map(p => (
              <PreviewExerciseRow
                key={p.exercise.id}
                planned={p}
                logged={loggedByPlannedId.get(p.exercise.id) ?? null}
              />
            ))}
            {offPlan.length > 0 && (
              <li>
                <div className="px-3 py-1.5 bg-amber-950/40 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                  Added by you
                </div>
                <ul className="divide-y divide-gray-800/60">
                  {offPlan.map(le => (
                    <PreviewOffPlanRow key={le.log.id} logged={le} />
                  ))}
                </ul>
              </li>
            )}
          </ul>
        </div>
      )}

      <button
        onClick={onStart}
        className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm py-3 rounded-xl transition-colors"
      >
        <PlayCircle size={18} />
        {log?.session ? 'Continue logging' : 'Start logging'}
      </button>
    </div>
  );
}

function PreviewExerciseRow({
  planned,
  logged,
}: {
  planned: PlannedExerciseFull;
  logged: LoggedExerciseFull | null;
}) {
  const sentinel = getSentinelType(planned.exerciseDef?.exercise_code ?? null);
  if (sentinel === 'text') {
    return (
      <li className="px-4 py-3">
        <p className="text-sm text-gray-200 italic whitespace-pre-wrap leading-relaxed">
          {planned.exercise.notes || '(empty note)'}
        </p>
      </li>
    );
  }
  const accent = planned.exerciseDef?.color ?? '#6b7280';
  const performedReps = logged ? sumPerformedReps(logged.sets) : 0;
  const delta = computeDelta(
    planned.exercise.summary_total_reps ?? null,
    performedReps,
    !!logged,
  );
  const allCompleted =
    logged != null && logged.sets.length > 0 && logged.sets.every(s => s.status === 'completed');

  return (
    <li className="flex gap-3 px-4 py-3">
      <div
        className="w-1 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-white">
            {planned.exerciseDef?.name ?? '(unknown exercise)'}
          </h3>
          {planned.exercise.variation_note && (
            <span className="text-[11px] text-gray-400 italic">
              {planned.exercise.variation_note}
            </span>
          )}
          {planned.exercise.is_combo && (
            <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
              Combo
            </span>
          )}
          {allCompleted && <CheckCircle2 size={13} className="text-emerald-400 flex-shrink-0" />}
        </div>

        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold w-7 flex-shrink-0">
            Plan
          </span>
          <StackedNotation
            raw={planned.exercise.prescription_raw}
            unit={planned.exercise.unit}
            isCombo={planned.exercise.is_combo}
          />
        </div>

        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold w-7 flex-shrink-0">
            Did
          </span>
          {logged ? (
            <>
              <LoggedStackedNotation sets={logged.sets} />
              {delta.state !== 'pending' && (
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                    delta.state === 'matched'
                      ? 'bg-emerald-900/40 text-emerald-300'
                      : delta.state === 'amber'
                      ? 'bg-amber-900/40 text-amber-300'
                      : 'bg-red-900/40 text-red-300'
                  }`}
                >
                  {Math.round(delta.ratio * 100)}%
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] text-gray-500 italic">Not logged</span>
          )}
        </div>

        {planned.exercise.notes?.trim() && (
          <p className="text-[11px] text-gray-400 italic whitespace-pre-wrap leading-snug">
            {planned.exercise.notes}
          </p>
        )}
        {logged?.log.performed_notes?.trim() && (
          <p className="text-[11px] text-gray-300 italic whitespace-pre-wrap leading-snug">
            <span className="text-gray-500 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">
              You
            </span>
            {logged.log.performed_notes}
          </p>
        )}
      </div>
    </li>
  );
}

function PreviewOffPlanRow({ logged }: { logged: LoggedExerciseFull }) {
  const ex: Exercise | null = logged.exercise;
  const accent = ex?.color ?? '#6b7280';
  const completedSets = logged.sets.filter((s: TrainingLogSet) => s.status === 'completed');
  return (
    <li className="flex gap-3 px-4 py-3">
      <div
        className="w-1 self-stretch rounded-full flex-shrink-0"
        style={{ backgroundColor: accent }}
        aria-hidden
      />
      <div className="flex-1 min-w-0 space-y-1">
        <h3 className="text-sm font-bold text-white">{ex?.name ?? '(unknown exercise)'}</h3>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-[9px] uppercase tracking-wide text-gray-500 font-semibold w-7 flex-shrink-0">
            Did
          </span>
          {logged.sets.length === 0 ? (
            <span className="text-[11px] text-gray-500 italic">No sets yet</span>
          ) : (
            <LoggedStackedNotation sets={logged.sets} />
          )}
          {completedSets.length > 0 && (
            <span className="text-[10px] text-gray-500">
              {completedSets.length}/{logged.sets.length} done
            </span>
          )}
        </div>
        {logged.log.performed_notes?.trim() && (
          <p className="text-[11px] text-gray-300 italic whitespace-pre-wrap leading-snug">
            {logged.log.performed_notes}
          </p>
        )}
      </div>
    </li>
  );
}

// PlannedExercise type re-export keeps callers' imports tidy.
export type { PlannedExercise };
