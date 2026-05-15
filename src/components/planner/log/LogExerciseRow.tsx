/**
 * LogExerciseRow — one paired (planned, actual) row in coach Log mode.
 *
 * Either side may be null: a planned exercise that was never logged shows
 * "Not logged"; an off-plan exercise (athlete added it) shows only the
 * actual side with an "Added by athlete" label upstream.
 */
import type {
  PlannedExercise,
  Exercise,
  TrainingLogMessage,
} from '../../../lib/database.types';
import {
  computeDelta,
  sumPerformedReps,
  avgPerformedLoad,
  maxPerformedLoad,
  type DeltaState,
  type LoggedExerciseFull,
} from '../../../lib/trainingLogModel';

const DELTA_BORDER: Record<DeltaState, string> = {
  matched: 'border-l-emerald-500',
  amber: 'border-l-amber-500',
  red: 'border-l-red-500',
  pending: 'border-l-gray-300',
};

const DELTA_BG: Record<DeltaState, string> = {
  matched: 'bg-emerald-50/40',
  amber: 'bg-amber-50/40',
  red: 'bg-red-50/40',
  pending: '',
};

const EX_STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Done',
  skipped: 'Skipped',
};

interface LogExerciseRowProps {
  planned: (PlannedExercise & { exercise: Exercise }) | null;
  logged: LoggedExerciseFull | null;
  sessionMessages: TrainingLogMessage[];
}

export function LogExerciseRow({ planned, logged, sessionMessages }: LogExerciseRowProps) {
  const performedReps = logged ? sumPerformedReps(logged.sets) : 0;
  const performedAvg = logged ? avgPerformedLoad(logged.sets) : 0;
  const performedMax = logged ? maxPerformedLoad(logged.sets) : 0;
  const delta = computeDelta(planned?.summary_total_reps ?? null, performedReps, !!logged);

  const exerciseMessages = logged
    ? sessionMessages.filter(m => m.exercise_id === logged.log.id)
    : [];

  const exerciseName =
    planned?.exercise?.name ?? logged?.exercise?.name ?? '(unknown exercise)';
  const variationNote = planned?.variation_note ?? null;
  const accentColor =
    planned?.exercise?.color ?? logged?.exercise?.color ?? null;

  const completedSets = logged?.sets.filter(s => s.status === 'completed') ?? [];

  return (
    <div className={`flex border-l-4 ${DELTA_BORDER[delta.state]} ${DELTA_BG[delta.state]}`}>
      {accentColor && (
        <div
          className="w-0.5 flex-shrink-0"
          style={{ backgroundColor: accentColor }}
          aria-hidden
        />
      )}
      <div className="flex-1 px-3 py-2 min-w-0">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <div className="flex items-baseline gap-2 flex-wrap min-w-0">
            <h4 className="text-xs font-bold text-gray-900">{exerciseName}</h4>
            {variationNote && (
              <span className="text-[10px] text-gray-500 italic">{variationNote}</span>
            )}
            {planned?.is_combo && (
              <span className="text-[9px] bg-blue-50 text-blue-700 font-medium px-1.5 py-0.5 rounded">
                Combo
              </span>
            )}
          </div>
          {logged && (
            <span className="text-[10px] text-gray-500">
              {EX_STATUS_LABEL[logged.log.status] ?? logged.log.status}
            </span>
          )}
        </div>

        {/* Planned row */}
        {planned ? (
          <div className="text-[11px] text-gray-700 mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-gray-400 uppercase text-[9px] tracking-wide">
              Plan
            </span>
            <span className="text-gray-700">{planned.prescription_raw || '—'}</span>
            {planned.summary_total_sets != null && planned.summary_total_reps != null && (
              <span className="text-gray-500">
                · {planned.summary_total_sets}s · {planned.summary_total_reps}r
                {planned.summary_avg_load != null && planned.summary_avg_load > 0 && (
                  <> · avg {Math.round(planned.summary_avg_load)}</>
                )}
              </span>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 italic mt-1">
            Added by athlete · not on plan
          </div>
        )}

        {/* Actual row */}
        {logged ? (
          <div className="text-[11px] text-gray-800 mt-0.5 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-gray-400 uppercase text-[9px] tracking-wide">
              Did
            </span>
            {logged.sets.length === 0 ? (
              <span className="text-gray-400 italic">No sets logged</span>
            ) : (
              <>
                <span>
                  {completedSets.length > 0
                    ? completedSets
                        .map(s => `${s.performed_load ?? '?'}×${s.performed_reps ?? '?'}${s.rpe != null ? `@${s.rpe}` : ''}`)
                        .join(', ')
                    : '—'}
                </span>
                <span className="text-gray-500">
                  · {performedReps}r
                  {performedAvg > 0 && <> · avg {Math.round(performedAvg)}</>}
                  {performedMax > 0 && <> · max {Math.round(performedMax)}</>}
                  {logged.log.technique_rating != null && (
                    <> · tech {logged.log.technique_rating}/5</>
                  )}
                </span>
                {planned && delta.state !== 'pending' && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      delta.state === 'matched'
                        ? 'bg-emerald-100 text-emerald-800'
                        : delta.state === 'amber'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {Math.round(delta.ratio * 100)}%
                  </span>
                )}
              </>
            )}
          </div>
        ) : planned ? (
          <div className="text-[11px] text-gray-400 italic mt-0.5">Not logged</div>
        ) : null}

        {logged?.log.performed_notes && (
          <p className="text-[10px] text-gray-500 italic mt-1 whitespace-pre-wrap">
            {logged.log.performed_notes}
          </p>
        )}

        {exerciseMessages.length > 0 && (
          <div className="mt-1 text-[10px] text-gray-500">
            💬 {exerciseMessages.length} comment{exerciseMessages.length > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  );
}
