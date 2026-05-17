/**
 * OffPlanExerciseCard — athlete-added (off-plan) exercise in Today.
 *
 * No prescription to compare against; the athlete adds sets ad hoc.
 * Each set still gets the two-button (✓ / ✗) status + kg / reps cells.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { TrainingLogSet, TrainingLogExercise, Exercise } from '../../../lib/database.types';
import { SetEntryRow } from './SetEntryRow';

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
}

export function OffPlanExerciseCard({
  logExercise,
  exercise,
  loggedSets,
  onSaveSet,
}: OffPlanExerciseCardProps) {
  const sortedSets = loggedSets.slice().sort((a, b) => a.set_number - b.set_number);
  // Always show one extra blank row so the athlete can keep adding sets
  // without an explicit "+ set" tap. The first time they fill it,
  // the next reload (or local state below) reveals the next blank.
  const [extraRows, setExtraRows] = useState(1);

  const accent = exercise?.color ?? '#6b7280';
  const name = exercise?.name ?? '(unknown exercise)';

  const nextSetNumber =
    sortedSets.length > 0
      ? Math.max(...sortedSets.map(s => s.set_number)) + 1
      : 1;

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
          />
        ))}
        {Array.from({ length: extraRows }).map((_, i) => (
          <SetEntryRow
            key={`blank-${nextSetNumber + i}`}
            input={{
              setNumber: nextSetNumber + i,
              plannedRepsText: '—',
              plannedLoadText: '—',
              plannedRepsValue: null,
              plannedLoadValue: null,
            }}
            logged={null}
            onSave={async patch => {
              await onSaveSet(patch);
              // Once they've engaged with this blank row, reveal another
              if (i === extraRows - 1) setExtraRows(n => n + 1);
            }}
          />
        ))}
        <button
          onClick={() => setExtraRows(n => n + 1)}
          className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-400 hover:text-white py-1.5 border border-dashed border-gray-700 rounded"
        >
          <Plus size={12} />
          Add set
        </button>
        {/* Suppress unused-var warning on logExercise: kept in API for parity */}
        <span className="hidden">{logExercise.id}</span>
      </div>
    </div>
  );
}
