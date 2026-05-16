/**
 * LogExerciseRow — one paired (planned, actual) row in coach Log mode.
 *
 * Both sides use the canonical StackedNotation visual: planned uses the
 * prescription string, actual reads back the set rows from the log.
 * Off-plan exercises (athlete added them) show only the actual side.
 *
 * Sentinel exercises (exercise_code === 'TEXT' / 'VIDEO' / 'IMAGE') are
 * informational, not logged. Their content lives in planned.notes and
 * we render it as the body of the row, no Plan/Did stack.
 */
import type {
  PlannedExercise,
  Exercise,
  TrainingLogMessage,
} from '../../../lib/database.types';
import {
  computeDelta,
  sumPerformedReps,
  type DeltaState,
  type LoggedExerciseFull,
} from '../../../lib/trainingLogModel';
import { StackedNotation, LoggedStackedNotation } from '../StackedNotation';
import { getSentinelType } from '../plannerUtils';

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
  const delta = computeDelta(planned?.summary_total_reps ?? null, performedReps, !!logged);

  const exerciseMessages = logged
    ? sessionMessages.filter(m => m.exercise_id === logged.log.id)
    : [];

  const exerciseName =
    planned?.exercise?.name ?? logged?.exercise?.name ?? '(unknown exercise)';
  const variationNote = planned?.variation_note ?? null;
  const accentColor =
    planned?.exercise?.color ?? logged?.exercise?.color ?? null;

  // Sentinel exercises (free-text blocks, video links, image references)
  // are informational. Their content lives in `notes`, not in
  // `prescription_raw`. Render the notes verbatim as the body.
  const sentinelType = planned
    ? getSentinelType(planned.exercise.exercise_code)
    : null;
  if (sentinelType === 'text') {
    return (
      <div className="flex border-l-4 border-l-gray-300">
        <div className="flex-1 px-3 py-2 min-w-0">
          <p
            style={{
              fontSize: 'var(--text-caption)',
              color: 'var(--color-text-primary)',
              fontStyle: 'italic',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.4,
              margin: 0,
            }}
          >
            {planned?.notes || '(empty note)'}
          </p>
        </div>
      </div>
    );
  }

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
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-gray-400 uppercase text-[9px] tracking-wide flex-shrink-0">
              Plan
            </span>
            <StackedNotation
              raw={planned.prescription_raw}
              unit={planned.unit}
              isCombo={planned.is_combo}
            />
          </div>
        ) : (
          <div className="text-[11px] text-gray-400 italic mt-1">
            Added by athlete · not on plan
          </div>
        )}

        {/* Actual row */}
        {logged ? (
          <div className="mt-1 flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-gray-400 uppercase text-[9px] tracking-wide flex-shrink-0">
              Did
            </span>
            <LoggedStackedNotation sets={logged.sets} />
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
            {logged.log.technique_rating != null && (
              <span className="text-[10px] text-gray-500">
                tech {logged.log.technique_rating}/5
              </span>
            )}
          </div>
        ) : planned ? (
          <div className="text-[11px] text-gray-400 italic mt-0.5">Not logged</div>
        ) : null}

        {planned?.notes?.trim() && (
          <p className="text-[10px] text-gray-600 italic mt-1 whitespace-pre-wrap">
            <span className="text-gray-400 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">Note</span>
            {planned.notes}
          </p>
        )}

        {logged?.log.performed_notes && (
          <p className="text-[10px] text-gray-500 italic mt-1 whitespace-pre-wrap">
            <span className="text-gray-400 not-italic uppercase text-[9px] font-semibold tracking-wide mr-1.5">Athlete</span>
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

