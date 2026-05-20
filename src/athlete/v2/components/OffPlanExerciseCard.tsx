/**
 * OffPlanExerciseCard — athlete-added (off-plan) exercise in Today.
 *
 * No prescription to compare against; the athlete adds sets ad hoc.
 * - "+ Add set" appends ONE editable blank row. New rows pre-fill with
 *   the last completed set's load/reps as the placeholder default, so
 *   tapping ✓ on a row left untouched logs "same as last".
 * - Each row gets a per-set delete (Trash) so accidental presses are
 *   reversible.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type {
  TrainingLogSet,
  TrainingLogExercise,
  Exercise,
  TrainingLogMessage,
} from '../../../lib/database.types';
import { SetEntryRow } from './SetEntryRow';
import { AthleteCommentsThread } from './AthleteCommentsThread';

interface OffPlanExerciseCardProps {
  logExercise: TrainingLogExercise;
  exercise: Exercise | null;
  loggedSets: TrainingLogSet[];
  onSaveSet: (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
  /** Remove the entire log_exercise (delete the card). */
  onDelete?: () => Promise<void>;
  /** Remove a single set within this exercise. */
  onDeleteSet?: (setId: string) => Promise<void>;
  /** Coach + athlete messages scoped to this exercise. */
  exerciseMessages?: TrainingLogMessage[];
  /** Post a comment scoped to this exercise. When provided, the thread
   *  input renders alongside the set rows. */
  onPostExerciseComment?: (body: string) => Promise<void>;
}

export function OffPlanExerciseCard({
  logExercise,
  exercise,
  loggedSets,
  onSaveSet,
  onDelete,
  onDeleteSet,
  exerciseMessages = [],
  onPostExerciseComment,
}: OffPlanExerciseCardProps) {
  const sortedSets = loggedSets.slice().sort((a, b) => a.set_number - b.set_number);
  /**
   * Number of empty trailing rows the user has explicitly requested via
   * "Add set". Persisted sets render before these; once a blank row's
   * data is saved, loggedSets gains the row and we decrement the
   * pendingBlanks count so it doesn't double up.
   */
  const [pendingBlanks, setPendingBlanks] = useState(0);
  /**
   * Track previous length so the pending-blank decrement only fires
   * when a set is ADDED (length increases). Without this, deleting a
   * set also decremented pendingBlanks, which made the trailing blank
   * row disappear and confused the athlete.
   */
  const prevSetCountRef = useRef(sortedSets.length);
  useEffect(() => {
    const prev = prevSetCountRef.current;
    const curr = sortedSets.length;
    if (curr > prev) {
      setPendingBlanks(p => Math.max(0, p - (curr - prev)));
    }
    prevSetCountRef.current = curr;
  }, [sortedSets.length]);

  const accent = exercise?.color ?? '#6b7280';
  const name = exercise?.name ?? '(unknown exercise)';

  const lastCompleted = [...sortedSets].reverse().find(s => s.status === 'completed');
  const defaultLoad = lastCompleted?.performed_load ?? null;
  const defaultReps = lastCompleted?.performed_reps ?? null;
  const nextSetNumber =
    sortedSets.length > 0 ? Math.max(...sortedSets.map(s => s.set_number)) + 1 : 1;

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-3">
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white truncate">{name}</h3>
            <span className="text-[9px] bg-amber-900/40 text-amber-300 font-medium px-1.5 py-0.5 rounded">
              Added by you
            </span>
          </div>
          <p className="text-[10px] text-gray-500 mt-0.5">No plan · log what you did</p>
        </div>
        {onDelete && (
          <button
            onClick={() => void onDelete()}
            className="p-1 text-gray-500 hover:text-red-400 flex-shrink-0"
            title="Remove this exercise"
            aria-label="Remove exercise"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      <div className="px-3 pb-3 space-y-1.5">
        {sortedSets.map(s => (
          <SetEntryRow
            key={s.id}
            input={{
              setNumber: s.set_number,
              plannedRepsText: '—',
              plannedLoadText: '—',
              plannedRepsValue: null,
              plannedLoadValue: null,
            }}
            logged={s}
            onSave={onSaveSet}
            onDelete={onDeleteSet ? () => onDeleteSet(s.id) : undefined}
          />
        ))}
        {Array.from({ length: pendingBlanks }).map((_, i) => (
          <SetEntryRow
            key={`blank-${nextSetNumber + i}`}
            input={{
              setNumber: nextSetNumber + i,
              plannedRepsText: defaultReps != null ? String(defaultReps) : '—',
              plannedLoadText: defaultLoad != null ? String(defaultLoad) : '—',
              plannedRepsValue: defaultReps,
              plannedLoadValue: defaultLoad,
            }}
            logged={null}
            onSave={onSaveSet}
            onDelete={() => setPendingBlanks(p => Math.max(0, p - 1))}
          />
        ))}
        <button
          onClick={() => setPendingBlanks(n => n + 1)}
          className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-400 hover:text-white py-1.5 border border-dashed border-gray-700 rounded"
        >
          <Plus size={12} />
          Add set
        </button>

        {(exerciseMessages.length > 0 || onPostExerciseComment) && (
          <div className="pt-1">
            <AthleteCommentsThread
              messages={exerciseMessages}
              onPost={onPostExerciseComment ?? (() => Promise.resolve())}
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}
