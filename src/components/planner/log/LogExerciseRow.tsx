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
} from '../../../lib/database.types';
import {
  computeDelta,
  sumPerformedReps,
  getDeltaBorderClass,
  getDeltaChipClass,
  type DeltaState,
  type LoggedExerciseFull,
} from '../../../lib/trainingLogModel';
import { Trash2, Pencil } from 'lucide-react';
import { DoneChip } from '../../log/DoneChip';
import { StackedNotation, LoggedStackedNotation } from '../StackedNotation';
import { getSentinelType } from '../sentinelUtils';
import { SentinelDisplay } from '../SentinelDisplay';

// Matched intentionally has no tint: the DoneChip already communicates
// "this is completed and matches the plan", so the row stays neutral.
// Amber/red still tint so deviations remain visually obvious when scanning
// a week of sessions.
const DELTA_BG: Record<DeltaState, string> = {
  matched: '',
  amber: 'bg-amber-50/40',
  red: 'bg-red-50/40',
  pending: '',
};

interface LogExerciseRowProps {
  planned: (PlannedExercise & { exercise: Exercise }) | null;
  logged: LoggedExerciseFull | null;
  /** Coach-side delete: drops the entire log_exercise + sets. */
  onDelete?: () => Promise<void>;
  /** Coach-side inline edit: opens the set-edit modal. */
  onEdit?: () => void;
}

export function LogExerciseRow({ planned, logged, onDelete, onEdit }: LogExerciseRowProps) {
  const performedReps = logged ? sumPerformedReps(logged.sets) : 0;

  // For free-text, GPP, and other non-quantified units, computeDelta would
  // see performedReps=0 vs a non-null planned total and emit 'red'. Guard
  // by passing null for both when the unit cannot produce a meaningful ratio.
  // (UF-04)
  const isUnquantified =
    planned != null &&
    (planned.exercise.unit === 'free_text' ||
      planned.exercise.unit === 'other' ||
      planned.exercise.unit === 'free_text_reps' ||
      getSentinelType(planned.exercise.exercise_code) === 'gpp');
  const delta = computeDelta(
    isUnquantified ? null : (planned?.summary_total_reps ?? null),
    isUnquantified ? 0 : performedReps,
    !!logged,
  );

  // Detect substitution: planned slot exists, athlete logged a
  // different exercise_id. We show the substituted name primarily and
  // a small "↔ for <planned>" chip so the coach immediately sees what
  // the slot was meant for.
  const isSubstituted =
    !!planned &&
    !!logged?.exercise &&
    logged.exercise.id !== planned.exercise.id;
  const exerciseName = isSubstituted
    ? logged!.exercise!.name
    : planned?.exercise?.name ?? logged?.exercise?.name ?? '(unknown exercise)';
  const variationNote = planned?.variation_note ?? null;
  const accentColor = isSubstituted
    ? logged!.exercise!.color
    : planned?.exercise?.color ?? logged?.exercise?.color ?? null;

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
          <SentinelDisplay
            exerciseCode={planned?.exercise_code}
            notes={planned?.notes}
            metadata={planned?.metadata}
            theme="light"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'image') {
    return (
      <div className="flex border-l-4 border-l-pink-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <SentinelDisplay
            exerciseCode={planned?.exercise_code}
            notes={planned?.notes}
            metadata={planned?.metadata}
            theme="light"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'video') {
    return (
      <div className="flex border-l-4 border-l-indigo-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <SentinelDisplay
            exerciseCode={planned?.exercise_code}
            notes={planned?.notes}
            metadata={planned?.metadata}
            theme="light"
          />
        </div>
      </div>
    );
  }
  if (sentinelType === 'gpp') {
    const plannedGpp = planned?.metadata?.gpp ?? null;
    const athleteGpp = logged?.log.metadata?.gpp ?? null;
    // When the athlete has logged GPP data, show both planned and performed
    // side-by-side so the coach can see what was changed. (UF-05)
    const hasAthleteData = athleteGpp != null;
    const displayRows = (athleteGpp ?? plannedGpp)?.rows ?? [];
    const plannedRows = plannedGpp?.rows ?? [];
    const doneCount = displayRows.filter(r => r.done).length;
    return (
      <div className="flex border-l-4 border-l-emerald-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
              {plannedGpp?.title || 'GPP'}
            </span>
            {displayRows.length > 0 && (
              <span className="text-[10px] text-gray-500">
                {doneCount}/{displayRows.length} done
              </span>
            )}
            {hasAthleteData && (
              <span className="text-[9px] text-blue-600 font-medium ml-1">athlete version</span>
            )}
          </div>
          {plannedGpp?.description && (
            <p className="text-[11px] text-gray-600 italic mb-1 whitespace-pre-wrap leading-snug">
              {plannedGpp.description}
            </p>
          )}
          {displayRows.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">No rows yet</p>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-gray-500">
                  <th className="text-left px-1 py-0.5">Exercise</th>
                  <th className="text-center px-1 py-0.5 w-12">Reps</th>
                  <th className="text-center px-1 py-0.5 w-10">Sets</th>
                  <th className={`text-left px-1 py-0.5 ${hasAthleteData ? 'w-28' : 'w-14'}`}>Load</th>
                  <th className="text-center px-1 py-0.5 w-8">✓</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => {
                  const plannedRow = plannedRows[i];
                  const loadChanged =
                    hasAthleteData &&
                    plannedRow != null &&
                    plannedRow.load !== row.load;
                  return (
                    <tr key={i} className={`border-t border-gray-100 ${row.done ? 'bg-emerald-50' : ''}`}>
                      <td className="px-1 py-0.5 text-gray-800">{row.exercise}</td>
                      <td className="px-1 py-0.5 text-center text-gray-700 tabular-nums">{row.reps || '—'}</td>
                      <td className="px-1 py-0.5 text-center text-gray-700 tabular-nums">{row.sets}</td>
                      <td className="px-1 py-0.5 text-gray-700">
                        {loadChanged ? (
                          <span className="flex flex-col gap-0 leading-tight">
                            <span className="text-gray-400 line-through text-[9px]">{plannedRow.load || '—'}</span>
                            <span className="text-blue-700 font-medium">{row.load || '—'}</span>
                          </span>
                        ) : (
                          row.load || '—'
                        )}
                      </td>
                      <td className="px-1 py-0.5 text-center text-emerald-600">{row.done ? '✓' : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex border-l-4 ${getDeltaBorderClass(delta.state)} ${DELTA_BG[delta.state]}`}>
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
            {isSubstituted && (
              <span
                className="text-[9px] bg-purple-100 text-purple-800 font-medium px-1.5 py-0.5 rounded"
                title={`Athlete substituted ${planned?.exercise?.name ?? 'the planned exercise'}`}
              >
                ⇄ for {planned?.exercise?.name}
              </span>
            )}
            {variationNote && (
              <span className="text-[10px] text-gray-500 italic">{variationNote}</span>
            )}
            {planned?.is_combo && (
              <span className="text-[9px] bg-blue-50 text-blue-700 font-medium px-1.5 py-0.5 rounded">
                Combo
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {exerciseMessages.length > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-600 font-medium" title={`${exerciseMessages.length} comment${exerciseMessages.length > 1 ? 's' : ''}`}>
                <MessageSquare size={9} />
                {exerciseMessages.length}
              </span>
            )}
            {logged && logged.log.status === 'completed' && (
              <DoneChip variant="light" />
            )}
            {logged && onEdit && (
              <button
                onClick={onEdit}
                className="p-1 text-gray-400 hover:text-blue-600"
                title="Edit the athlete's log for this exercise"
                aria-label="Edit log"
              >
                <Pencil size={11} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => void onDelete()}
                className="p-1 text-gray-400 hover:text-red-600"
                title="Remove this logged exercise"
                aria-label="Delete logged exercise"
              >
                <Trash2 size={11} />
              </button>
            )}
          </div>
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
                className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${getDeltaChipClass(delta.state)}`}
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
      </div>
    </div>
  );
}

