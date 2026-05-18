/**
 * SetEntryRow — one logged set inside an ExerciseLogCard.
 *
 * - Two buttons up front: ✓ marks the set completed, ✗ marks it skipped.
 *   Tap an active button again to go back to pending.
 * - Then two numeric cells: kg and reps. No RPE.
 * - useEffect deps are primitive so a parent re-render with a fresh
 *   `logged` reference does NOT stomp the user's mid-edit local state.
 */
import { useEffect, useState } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import type { TrainingLogSet, PlannedSetLine } from '../../../lib/database.types';

export interface SetRowInput {
  setNumber: number;
  /** Display string for the planned reps cell ("5" or "3-5"). */
  plannedRepsText: string;
  /** Display string for the planned load cell ("80" or "80%" or "75-80"). */
  plannedLoadText: string;
  /** Raw numeric used to compute planned_reps when saving. */
  plannedRepsValue: number | null;
  /** Raw numeric used to compute planned_load when saving. */
  plannedLoadValue: number | null;
}

interface SetEntryRowProps {
  input: SetRowInput;
  logged: TrainingLogSet | null;
  /** Called on user edits. Parent owns persistence and the saving spinner. */
  onSave: (patch: {
    setNumber: number;
    performedLoad: number | null;
    performedReps: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
  /** Optional per-set delete: when present, renders a trash icon.
   *  Can be sync (for removing a pending blank row that has no DB
   *  presence yet) or async (for deleting a persisted row). */
  onDelete?: () => void | Promise<void>;
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function SetEntryRow({ input, logged, onSave, onDelete }: SetEntryRowProps) {
  const [load, setLoad] = useState(logged?.performed_load != null ? String(logged.performed_load) : '');
  const [reps, setReps] = useState(logged?.performed_reps != null ? String(logged.performed_reps) : '');
  const [status, setStatus] = useState<TrainingLogSet['status']>(logged?.status ?? 'pending');
  const [busy, setBusy] = useState(false);

  // Sync local state from server data using primitive dependencies, so a
  // parent re-render with a freshly-allocated `logged` object doesn't
  // reset the inputs while the user is typing.
  useEffect(() => {
    setLoad(logged?.performed_load != null ? String(logged.performed_load) : '');
  }, [logged?.performed_load]);
  useEffect(() => {
    setReps(logged?.performed_reps != null ? String(logged.performed_reps) : '');
  }, [logged?.performed_reps]);
  useEffect(() => {
    setStatus(logged?.status ?? 'pending');
  }, [logged?.status]);

  const commit = async (overrides: Partial<{
    load: string;
    reps: string;
    status: TrainingLogSet['status'];
  }> = {}) => {
    const nextLoad = overrides.load ?? load;
    const nextReps = overrides.reps ?? reps;
    const nextStat = overrides.status ?? status;

    setBusy(true);
    try {
      const parsedLoad = parseNumber(nextLoad);
      const parsedReps = parseNumber(nextReps);
      // When marking completed without explicit values, assume the
      // athlete executed the set as prescribed. This means tapping the
      // checkmark on a planned set is enough — no manual entry needed
      // if everything went as written.
      const completing = nextStat === 'completed';
      const performedLoad =
        parsedLoad ?? (completing ? input.plannedLoadValue : null);
      const performedReps =
        parsedReps != null
          ? Math.round(parsedReps)
          : completing
          ? input.plannedRepsValue
          : null;
      await onSave({
        setNumber: input.setNumber,
        performedLoad,
        performedReps,
        status: nextStat,
        plannedLoad: input.plannedLoadValue,
        plannedReps: input.plannedRepsValue,
      });
    } finally {
      setBusy(false);
    }
  };

  const setDone = () => {
    const next: TrainingLogSet['status'] = status === 'completed' ? 'pending' : 'completed';
    setStatus(next);
    void commit({ status: next });
  };

  const setSkipped = () => {
    const next: TrainingLogSet['status'] = status === 'skipped' ? 'pending' : 'skipped';
    setStatus(next);
    void commit({ status: next });
  };

  const isDone = status === 'completed';
  const isSkipped = status === 'skipped';

  return (
    <div className={`flex items-center gap-2 px-2 py-2 rounded-lg ${
      isDone
        ? 'bg-emerald-950/40 border border-emerald-900/50'
        : isSkipped
        ? 'bg-red-950/40 border border-red-900/50'
        : 'bg-gray-900/50 border border-gray-800'
    }`}>
      <span className="flex-shrink-0 w-5 text-center text-[10px] font-semibold text-gray-500">
        {input.setNumber}
      </span>

      <div className="flex flex-shrink-0 gap-1">
        <button
          onClick={setDone}
          disabled={busy}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors border ${
            isDone
              ? 'bg-emerald-500 border-emerald-400 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-500 hover:bg-gray-700 hover:text-emerald-300'
          }`}
          title="Did this set"
          aria-pressed={isDone}
        >
          <Check size={16} strokeWidth={3} />
        </button>
        <button
          onClick={setSkipped}
          disabled={busy}
          className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors border ${
            isSkipped
              ? 'bg-red-500 border-red-400 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-500 hover:bg-gray-700 hover:text-red-300'
          }`}
          title="Didn't do this set"
          aria-pressed={isSkipped}
        >
          <X size={16} strokeWidth={3} />
        </button>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-1.5">
        <NumericCell
          value={load}
          placeholder={input.plannedLoadText}
          unit="kg"
          onChange={setLoad}
          onCommit={() => commit()}
          disabled={busy || isSkipped}
        />
        <NumericCell
          value={reps}
          placeholder={input.plannedRepsText}
          unit="r"
          onChange={setReps}
          onCommit={() => commit()}
          disabled={busy || isSkipped}
        />
      </div>
      {onDelete && (
        <button
          onClick={() => void onDelete()}
          disabled={busy}
          className="p-1.5 text-gray-500 hover:text-red-400 flex-shrink-0"
          title="Delete this set"
          aria-label="Delete set"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function NumericCell({
  value, placeholder, unit, onChange, onCommit, disabled,
}: {
  value: string;
  placeholder: string;
  unit: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 focus-within:border-blue-500">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 min-w-0 bg-transparent text-white text-sm font-medium focus:outline-none disabled:opacity-50 placeholder:text-gray-600"
      />
      {unit && <span className="text-[10px] text-gray-500 flex-shrink-0">{unit}</span>}
    </div>
  );
}

/**
 * Expand planned set lines into one row per planned set.
 * A line "3 sets × 5 reps at 80kg" becomes three rows numbered 1,2,3.
 */
export function expandSetLines(setLines: PlannedSetLine[]): SetRowInput[] {
  const out: SetRowInput[] = [];
  let setNumber = 1;
  for (const line of setLines) {
    const count = Math.max(1, line.sets ?? 1);
    const repsText = line.reps_text ?? String(line.reps ?? '');
    const loadText =
      line.load_max != null && line.load_max !== line.load_value
        ? `${line.load_value}-${line.load_max}`
        : String(line.load_value ?? '');
    for (let i = 0; i < count; i += 1) {
      out.push({
        setNumber,
        plannedRepsText: repsText || '—',
        plannedLoadText: loadText || '—',
        plannedRepsValue: line.reps ?? null,
        plannedLoadValue: line.load_value ?? null,
      });
      setNumber += 1;
    }
  }
  return out;
}
