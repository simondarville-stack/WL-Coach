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
  ExerciseStub,
} from '../../../lib/database.types';
import { SetEntryRow } from './SetEntryRow';
import { useAutoCommit } from '../lib/useAutoCommit';

interface OffPlanExerciseCardProps {
  logExercise: TrainingLogExercise;
  // Stub is the optimistic shape right after off-plan add — name+color
  // suffice for what this card renders.
  exercise: Exercise | ExerciseStub | null;
  loggedSets: TrainingLogSet[];
  onSaveSet: (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
  /** Remove the entire log_exercise (delete the card). The parent
   *  shows a confirm modal and dispatches the delete from there. */
  onDelete?: () => void;
  /** Remove a single set within this exercise. Same fire-and-forget
   *  pattern as onDelete. */
  onDeleteSet?: (setId: string) => void;
  /** Persists athlete-written notes on this exercise. */
  onUpdateNotes: (notes: string) => Promise<void>;
}

export function OffPlanExerciseCard({
  logExercise,
  exercise,
  loggedSets,
  onSaveSet,
  onDelete,
  onDeleteSet,
  onUpdateNotes,
}: OffPlanExerciseCardProps) {
  const [notes, setNotes] = useState(logExercise.performed_notes ?? '');
  useEffect(() => {
    setNotes(logExercise.performed_notes ?? '');
  }, [logExercise.performed_notes]);
  // Persist on blur AND on debounce / app-background / unmount (mobile lock
  // doesn't fire blur). Self-guards on a real change.
  const commitNotes = () => {
    if ((logExercise.performed_notes ?? '') !== notes) void onUpdateNotes(notes);
  };
  useAutoCommit(notes, commitNotes);
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

  // Athlete-authored combination: members + name + ribbon colour live on
  // the log row's metadata (the log schema has no is_combo column). When
  // present, the card renders the combo identity and lets the reps cells
  // accept tuple notation ("2+1").
  const combo = logExercise.metadata?.combo ?? null;
  const accent = combo?.color ?? exercise?.color ?? '#6b7280';
  const name = combo
    ? combo.name?.trim() ||
      combo.members.map(m => m.name).filter(Boolean).join(' + ') ||
      '(combination)'
    : exercise?.name ?? '(unknown exercise)';

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
          {combo && combo.members.length > 0 ? (
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {combo.members.map((m, idx) => (
                <span key={m.exerciseId + idx} className="inline-flex items-center gap-1 text-[10px] text-gray-300">
                  {idx > 0 && <span className="text-gray-600">+</span>}
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.color ?? '#6b7280' }}
                    aria-hidden
                  />
                  <span>{m.name}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-gray-500 mt-0.5">No plan · log what you did</p>
          )}
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
              comboReps: !!combo,
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
              comboReps: !!combo,
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

        <div className="pt-1">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            onBlur={commitNotes}
            placeholder="Notes on this exercise…"
            rows={2}
            className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
          />
        </div>
      </div>
    </div>
  );
}
