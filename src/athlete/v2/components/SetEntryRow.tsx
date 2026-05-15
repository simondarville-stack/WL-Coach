/**
 * SetEntryRow — one logged set inside an ExerciseLogCard.
 *
 * Renders the planned values in placeholders and saves on blur. The status
 * button cycles pending → completed → skipped. Failed is reachable from a
 * long-press menu (added in P5 if asked for).
 */
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
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
    rpe: number | null;
    status: 'pending' | 'completed' | 'skipped' | 'failed';
    plannedLoad: number | null;
    plannedReps: number | null;
  }) => Promise<void>;
}

function nextStatus(s: TrainingLogSet['status'] | undefined): TrainingLogSet['status'] {
  switch (s) {
    case 'completed':
      return 'skipped';
    case 'skipped':
      return 'pending';
    default:
      return 'completed';
  }
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = parseFloat(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

export function SetEntryRow({ input, logged, onSave }: SetEntryRowProps) {
  const [load, setLoad] = useState(logged?.performed_load != null ? String(logged.performed_load) : '');
  const [reps, setReps] = useState(logged?.performed_reps != null ? String(logged.performed_reps) : '');
  const [rpe, setRpe] = useState(logged?.rpe != null ? String(logged.rpe) : '');
  const [status, setStatus] = useState<TrainingLogSet['status']>(logged?.status ?? 'pending');
  const [busy, setBusy] = useState(false);

  // Keep local state in sync if parent re-fetches the row
  useEffect(() => {
    setLoad(logged?.performed_load != null ? String(logged.performed_load) : '');
    setReps(logged?.performed_reps != null ? String(logged.performed_reps) : '');
    setRpe(logged?.rpe != null ? String(logged.rpe) : '');
    setStatus(logged?.status ?? 'pending');
  }, [logged]);

  const commit = async (overrides: Partial<{
    load: string;
    reps: string;
    rpe: string;
    status: TrainingLogSet['status'];
  }> = {}) => {
    const nextLoad = overrides.load ?? load;
    const nextReps = overrides.reps ?? reps;
    const nextRpe = overrides.rpe ?? rpe;
    const nextStat = overrides.status ?? status;

    setBusy(true);
    try {
      await onSave({
        setNumber: input.setNumber,
        performedLoad: parseNumber(nextLoad),
        performedReps: parseNumber(nextReps) != null ? Math.round(parseNumber(nextReps) as number) : null,
        rpe: parseNumber(nextRpe),
        status: nextStat,
        plannedLoad: input.plannedLoadValue,
        plannedReps: input.plannedRepsValue,
      });
    } finally {
      setBusy(false);
    }
  };

  const cycleStatus = () => {
    const next = nextStatus(status);
    setStatus(next);
    void commit({ status: next });
  };

  const isDone = status === 'completed';
  const isSkipped = status === 'skipped';

  return (
    <div className={`flex items-center gap-2 px-2 py-2 rounded-lg ${
      isDone ? 'bg-emerald-950/40 border border-emerald-900/50' :
      isSkipped ? 'bg-red-950/40 border border-red-900/50' :
      'bg-gray-900/50 border border-gray-800'
    }`}>
      <button
        onClick={cycleStatus}
        disabled={busy}
        className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
          isDone ? 'bg-emerald-500 text-white' :
          isSkipped ? 'bg-red-500 text-white' :
          'bg-gray-800 text-gray-500 hover:bg-gray-700'
        }`}
        title={`Status: ${status}`}
      >
        {isDone ? <Check size={16} /> : isSkipped ? <X size={16} /> : <span className="text-xs font-bold">{input.setNumber}</span>}
      </button>

      <div className="flex-1 grid grid-cols-3 gap-1.5">
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
        <NumericCell
          value={rpe}
          placeholder="RPE"
          unit=""
          onChange={setRpe}
          onCommit={() => commit()}
          disabled={busy || isSkipped}
        />
      </div>
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
