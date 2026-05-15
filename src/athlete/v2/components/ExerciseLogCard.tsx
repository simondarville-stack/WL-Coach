/**
 * ExerciseLogCard — one planned exercise, mobile-first, with set entry.
 *
 * Renders the prescription on top and a stack of set rows below.
 * "Log as prescribed" copies planned values into performed and marks all
 * sets completed.
 */
import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import type { TrainingLogSet, TrainingLogExercise } from '../../../lib/database.types';
import type { PlannedExerciseFull } from '../../../lib/trainingLogService';
import { SetEntryRow, expandSetLines } from './SetEntryRow';

interface ExerciseLogCardProps {
  planned: PlannedExerciseFull;
  loggedExercise: TrainingLogExercise | null;
  loggedSets: TrainingLogSet[];
  onSaveSet: (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    rpe: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
  onLogAsPrescribed: () => Promise<void>;
  onUpdateNotes: (notes: string) => Promise<void>;
  onMarkComplete: () => Promise<void>;
}

export function ExerciseLogCard({
  planned,
  loggedExercise,
  loggedSets,
  onSaveSet,
  onLogAsPrescribed,
  onUpdateNotes,
  onMarkComplete,
}: ExerciseLogCardProps) {
  const [expanded, setExpanded] = useState(true);
  const [notes, setNotes] = useState(loggedExercise?.performed_notes ?? '');
  const [savingPrescribed, setSavingPrescribed] = useState(false);

  const rows = useMemo(() => expandSetLines(planned.setLines), [planned.setLines]);
  const setBySetNumber = useMemo(() => {
    const m = new Map<number, TrainingLogSet>();
    loggedSets.forEach(s => m.set(s.set_number, s));
    return m;
  }, [loggedSets]);

  const completedCount = loggedSets.filter(s => s.status === 'completed').length;
  const allCompleted = rows.length > 0 && completedCount >= rows.length;
  const accent = planned.exerciseDef?.color ?? '#3B82F6';

  const handleLogAsPrescribed = async () => {
    setSavingPrescribed(true);
    try {
      await onLogAsPrescribed();
    } finally {
      setSavingPrescribed(false);
    }
  };

  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 px-3 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <div
          className="w-1 self-stretch rounded-full flex-shrink-0 mt-0.5"
          style={{ backgroundColor: accent }}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white truncate">
              {planned.exerciseDef?.name ?? '(unknown exercise)'}
            </h3>
            {allCompleted && <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />}
            {planned.exercise.is_combo && (
              <span className="text-[9px] bg-blue-900/50 text-blue-300 font-medium px-1.5 py-0.5 rounded">
                Combo
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5 truncate">
            {planned.exercise.prescription_raw || '—'}
          </p>
          {planned.exercise.variation_note && (
            <p className="text-[10px] text-gray-500 italic mt-0.5 truncate">
              {planned.exercise.variation_note}
            </p>
          )}
        </div>
        <div className="text-[10px] text-gray-500 flex-shrink-0 mt-0.5">
          {completedCount}/{rows.length || '—'}
          {expanded ? (
            <ChevronDown size={14} className="inline-block ml-1" />
          ) : (
            <ChevronRight size={14} className="inline-block ml-1" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {rows.length === 0 ? (
            <div className="text-xs text-gray-500 italic py-3 text-center">
              No set lines defined for this exercise
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleLogAsPrescribed}
                  disabled={savingPrescribed || allCompleted}
                  className="flex-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-800 disabled:text-gray-500 text-white font-semibold py-2 rounded-md transition-colors"
                >
                  {savingPrescribed ? 'Saving…' : allCompleted ? 'All sets complete' : 'Log as prescribed'}
                </button>
                {!allCompleted && loggedSets.length > 0 && (
                  <button
                    onClick={onMarkComplete}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 py-2 px-3 rounded-md transition-colors"
                    title="Mark this exercise complete"
                  >
                    Done
                  </button>
                )}
              </div>

              <div className="space-y-1.5">
                {rows.map(row => (
                  <SetEntryRow
                    key={row.setNumber}
                    input={row}
                    logged={setBySetNumber.get(row.setNumber) ?? null}
                    onSave={onSaveSet}
                  />
                ))}
              </div>
            </>
          )}

          <div className="pt-1">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              onBlur={() => {
                if ((loggedExercise?.performed_notes ?? '') !== notes) {
                  void onUpdateNotes(notes);
                }
              }}
              placeholder="Notes on this exercise…"
              rows={2}
              className="w-full text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}
