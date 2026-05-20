/**
 * CoachSetEditModal — coach-side inline editor for one log_exercise's sets.
 *
 * Lets the coach correct a misentered value (e.g., athlete typed 80 but
 * lifted 85), flip status between ✓/✗, delete an erroneous set, or
 * append a missed one. Each input commits on blur via upsertLoggedSet;
 * delete is immediate. The modal is light-themed to match the coach
 * planner's surface.
 */
import { useEffect, useState } from 'react';
import { Check, X, Trash2, Plus } from 'lucide-react';
import type { TrainingLogSet } from '../../../lib/database.types';
import { upsertLoggedSet, deleteLoggedSet } from '../../../lib/trainingLogService';
import { parseNumericInput } from '../../../lib/trainingLogModel';

interface CoachSetEditModalProps {
  open: boolean;
  exerciseName: string;
  logExerciseId: string;
  loggedSets: TrainingLogSet[];
  onClose: () => void;
  /** Called after every successful write so the parent can refresh. */
  onChanged: () => void;
}

export function CoachSetEditModal({
  open,
  exerciseName,
  logExerciseId,
  loggedSets,
  onClose,
  onChanged,
}: CoachSetEditModalProps) {
  // Local mirror so adding a brand-new (not yet persisted) row is
  // possible without immediately writing.
  const [rows, setRows] = useState<Array<Partial<TrainingLogSet> & { setNumber: number; localId: string }>>(
    [],
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      const mapped = loggedSets
        .slice()
        .sort((a, b) => a.set_number - b.set_number)
        .map(s => ({ ...s, setNumber: s.set_number, localId: s.id }));
      setRows(mapped);
      setError(null);
    }
  }, [open, loggedSets]);

  if (!open) return null;

  const nextSetNumber = rows.length > 0 ? Math.max(...rows.map(r => r.setNumber)) + 1 : 1;

  const addRow = () => {
    setRows(prev => [
      ...prev,
      {
        setNumber: nextSetNumber,
        localId: `new-${Date.now()}`,
        performed_load: null,
        performed_reps: null,
        status: 'completed',
      },
    ]);
  };

  const saveRow = async (
    localId: string,
    patch: Partial<Pick<TrainingLogSet, 'performed_load' | 'performed_reps' | 'status'>>,
  ) => {
    setError(null);
    const idx = rows.findIndex(r => r.localId === localId);
    if (idx < 0) return;
    const row = rows[idx];
    const merged = { ...row, ...patch };
    setRows(prev => prev.map(r => (r.localId === localId ? merged : r)));
    try {
      const saved = await upsertLoggedSet({
        logExerciseId,
        setNumber: row.setNumber,
        plannedLoad: row.planned_load ?? null,
        plannedReps: row.planned_reps ?? null,
        performedLoad: merged.performed_load ?? null,
        performedReps: merged.performed_reps ?? null,
        rpe: null,
        status: merged.status ?? 'completed',
      });
      // Replace local id with the real id so subsequent edits work.
      setRows(prev =>
        prev.map(r =>
          r.localId === localId ? { ...saved, setNumber: saved.set_number, localId: saved.id } : r,
        ),
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeRow = async (localId: string) => {
    const row = rows.find(r => r.localId === localId);
    if (!row) return;
    if (!window.confirm(`Delete set ${row.setNumber}?`)) return;
    // Persisted rows have a real id; client-only rows just disappear.
    if (row.id) {
      try {
        await deleteLoggedSet(row.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setRows(prev => prev.filter(r => r.localId !== localId));
    onChanged();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Edit log</h3>
            <p className="text-[11px] text-gray-500 truncate">{exerciseName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-900"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
          {rows.length === 0 && (
            <p className="text-xs text-gray-500 italic text-center py-4">
              No sets yet. Add one to record what the athlete lifted.
            </p>
          )}
          {rows.map(r => (
            <EditableRow
              key={r.localId}
              row={r}
              onSave={patch => void saveRow(r.localId, patch)}
              onDelete={() => void removeRow(r.localId)}
            />
          ))}
          <button
            onClick={addRow}
            className="w-full inline-flex items-center justify-center gap-1 text-[11px] text-gray-600 hover:text-gray-900 py-1.5 border border-dashed border-gray-300 hover:border-gray-500 rounded"
          >
            <Plus size={12} />
            Add set
          </button>
          {error && (
            <p className="text-[11px] text-red-700 break-all">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-gray-200">
          <button
            onClick={onClose}
            className="text-xs font-semibold text-gray-700 hover:text-gray-900 px-3 py-1.5 rounded"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function EditableRow({
  row,
  onSave,
  onDelete,
}: {
  row: Partial<TrainingLogSet> & { setNumber: number; localId: string };
  onSave: (patch: Partial<Pick<TrainingLogSet, 'performed_load' | 'performed_reps' | 'status'>>) => void;
  onDelete: () => void;
}) {
  const [load, setLoad] = useState(row.performed_load != null ? String(row.performed_load) : '');
  const [reps, setReps] = useState(row.performed_reps != null ? String(row.performed_reps) : '');
  const status = row.status ?? 'completed';
  const isDone = status === 'completed';
  const isSkipped = status === 'skipped';

  useEffect(() => {
    setLoad(row.performed_load != null ? String(row.performed_load) : '');
  }, [row.performed_load]);
  useEffect(() => {
    setReps(row.performed_reps != null ? String(row.performed_reps) : '');
  }, [row.performed_reps]);

  const commit = () => {
    const parsedReps = parseNumericInput(reps);
    onSave({
      performed_load: parseNumericInput(load),
      performed_reps: parsedReps != null ? Math.round(parsedReps) : null,
    });
  };

  const cycleDone = () => {
    onSave({ status: isDone ? 'pending' : 'completed' });
  };
  const cycleSkipped = () => {
    onSave({ status: isSkipped ? 'pending' : 'skipped' });
  };

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border ${
        isDone
          ? 'bg-emerald-50 border-emerald-200'
          : isSkipped
          ? 'bg-red-50 border-red-200'
          : 'bg-gray-50 border-gray-200'
      }`}
    >
      <span className="flex-shrink-0 w-5 text-center text-[10px] font-semibold text-gray-500">
        {row.setNumber}
      </span>
      <div className="flex flex-shrink-0 gap-1">
        <button
          onClick={cycleDone}
          className={`w-7 h-7 rounded flex items-center justify-center border ${
            isDone
              ? 'bg-emerald-500 border-emerald-400 text-white'
              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100'
          }`}
          title="Did this set"
        >
          <Check size={14} strokeWidth={3} />
        </button>
        <button
          onClick={cycleSkipped}
          className={`w-7 h-7 rounded flex items-center justify-center border ${
            isSkipped
              ? 'bg-red-500 border-red-400 text-white'
              : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-100'
          }`}
          title="Didn't do this set"
        >
          <X size={14} strokeWidth={3} />
        </button>
      </div>
      <input
        type="text"
        inputMode="decimal"
        value={load}
        onChange={e => setLoad(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={row.planned_load != null ? String(row.planned_load) : 'kg'}
        className="flex-1 min-w-0 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
      />
      <span className="text-[9px] text-gray-500">kg</span>
      <input
        type="text"
        inputMode="decimal"
        value={reps}
        onChange={e => setReps(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={row.planned_reps != null ? String(row.planned_reps) : 'r'}
        className="w-16 bg-white border border-gray-300 rounded px-2 py-1 text-sm text-gray-900 focus:outline-none focus:border-blue-500"
      />
      <span className="text-[9px] text-gray-500">r</span>
      <button
        onClick={onDelete}
        className="p-1 text-gray-400 hover:text-red-600"
        title="Delete this set"
        aria-label="Delete set"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
