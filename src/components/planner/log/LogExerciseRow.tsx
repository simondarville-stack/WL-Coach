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
import { useState } from 'react';
import { MessageSquare, ChevronDown, ChevronRight, Trash2, Pencil } from 'lucide-react';
import { StackedNotation, LoggedStackedNotation } from '../StackedNotation';
import { getSentinelType } from '../plannerUtils';
import { LogCommentsThread } from './LogCommentsThread';

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


interface LogExerciseRowProps {
  planned: (PlannedExercise & { exercise: Exercise }) | null;
  logged: LoggedExerciseFull | null;
  sessionMessages: TrainingLogMessage[];
  onPostComment?: (body: string) => Promise<void>;
  /** Coach-side delete: drops the entire log_exercise + sets. */
  onDelete?: () => Promise<void>;
  /** Coach-side inline edit: opens the set-edit modal. */
  onEdit?: () => void;
}

export function LogExerciseRow({ planned, logged, sessionMessages, onPostComment, onDelete, onEdit }: LogExerciseRowProps) {
  const performedReps = logged ? sumPerformedReps(logged.sets) : 0;
  const delta = computeDelta(planned?.summary_total_reps ?? null, performedReps, !!logged);

  const exerciseMessages = logged
    ? sessionMessages.filter(m => m.exercise_id === logged.log.id)
    : [];

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
  if (sentinelType === 'gpp') {
    const plannedGpp = planned?.metadata?.gpp ?? null;
    const athleteGpp = logged?.log.metadata?.gpp ?? null;
    // Athlete state wins if present; coach sees what the athlete logged
    // (with their per-row done flags), otherwise falls back to planned.
    const display = athleteGpp ?? plannedGpp;
    const rows = display?.rows ?? [];
    const doneCount = rows.filter(r => r.done).length;
    return (
      <div className="flex border-l-4 border-l-emerald-400">
        <div className="flex-1 px-3 py-2 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
              {plannedGpp?.title || 'GPP'}
            </span>
            {rows.length > 0 && (
              <span className="text-[10px] text-gray-500">
                {doneCount}/{rows.length} done
              </span>
            )}
          </div>
          {plannedGpp?.description && (
            <p className="text-[11px] text-gray-600 italic mb-1 whitespace-pre-wrap leading-snug">
              {plannedGpp.description}
            </p>
          )}
          {rows.length === 0 ? (
            <p className="text-[10px] text-gray-400 italic">No rows yet</p>
          ) : (
            <table className="w-full text-[11px] border-collapse">
              <thead>
                <tr className="text-[9px] uppercase tracking-wide text-gray-500">
                  <th className="text-left px-1 py-0.5">Exercise</th>
                  <th className="text-center px-1 py-0.5 w-12">Reps</th>
                  <th className="text-center px-1 py-0.5 w-10">Sets</th>
                  <th className="text-left px-1 py-0.5 w-14">Load</th>
                  <th className="text-center px-1 py-0.5 w-8">✓</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={`border-t border-gray-100 ${row.done ? 'bg-emerald-50' : ''}`}>
                    <td className="px-1 py-0.5 text-gray-800">{row.exercise}</td>
                    <td className="px-1 py-0.5 text-center text-gray-700 tabular-nums">{row.reps || '—'}</td>
                    <td className="px-1 py-0.5 text-center text-gray-700 tabular-nums">{row.sets}</td>
                    <td className="px-1 py-0.5 text-gray-700">{row.load || '—'}</td>
                    <td className="px-1 py-0.5 text-center text-emerald-600">{row.done ? '✓' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
            {logged && logged.log.status === 'completed' && (
              <span className="text-[10px] text-emerald-700 font-semibold">Done</span>
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

        {logged && onPostComment && (
          <ExerciseCommentsToggle
            count={exerciseMessages.length}
            messages={exerciseMessages}
            onPost={onPostComment}
          />
        )}
      </div>
    </div>
  );
}

function ExerciseCommentsToggle({
  count,
  messages,
  onPost,
}: {
  count: number;
  messages: TrainingLogMessage[];
  onPost: (body: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-800"
        aria-expanded={open}
      >
        <MessageSquare size={10} />
        {count > 0 ? `${count} comment${count > 1 ? 's' : ''}` : 'Comment'}
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>
      {open && (
        <div className="mt-1 px-2 py-1.5 bg-gray-50 rounded border border-gray-100">
          <LogCommentsThread compact messages={messages} onPost={onPost} />
        </div>
      )}
    </div>
  );
}

