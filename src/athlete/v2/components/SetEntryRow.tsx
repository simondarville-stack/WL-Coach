/**
 * SetEntryRow — one logged set inside an ExerciseLogCard.
 *
 * - Two buttons up front: ✓ marks the set completed, ✗ marks it skipped.
 *   Tap an active button again to go back to pending.
 * - Then two numeric cells: kg and reps. No RPE.
 * - useEffect deps are primitive so a parent re-render with a fresh
 *   `logged` reference does NOT stomp the user's mid-edit local state.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import type { TrainingLogSet, PlannedSetLine } from '../../../lib/database.types';
import { parseNumericInput, parseRepsInput } from '../../../lib/trainingLogModel';

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
  /** Whether plannedLoadValue is a real kilogram (absolute_kg). For
   *  percentage / rpe the planned "load" is a percent or RPE number — it
   *  must NOT be back-filled into performed_load as kg on a one-tap ✓.
   *  Defaults to true (treated as kg) when omitted, preserving the
   *  behaviour for off-plan / extra rows that carry real kg. (TYPE-TRANSLATION-3) */
  loadIsKg?: boolean;
  /** When true, the kg + reps cells collapse into ONE merged cell. Used
   *  for free_text / "other" units where there's nothing to quantify. */
  freeTextMode?: boolean;
  /** Coach's prose to show in the merged cell on planned rows. Undefined
   *  ⇒ the merged cell becomes an editable text input bound to the
   *  set's notes column (athlete-added extra rows). */
  freeTextPlanned?: string;
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
    /** Free-text equivalent of performed values for non-quantified
     *  exercises. Persisted on training_log_sets.notes. */
    performedText?: string | null;
  }) => Promise<void>;
  /** Optional per-set delete: when present, renders a trash icon.
   *  Can be sync (for removing a pending blank row that has no DB
   *  presence yet) or async (for deleting a persisted row). */
  onDelete?: () => void | Promise<void>;
  /** View-only render: keeps the same chrome (status pills, kg/reps
   *  cells, delete affordance) but disables inputs and suppresses the
   *  done/skip buttons + delete. Used by the group viewer where there's
   *  no athlete profile to write against. */
  readOnly?: boolean;
}

export function SetEntryRow({ input, logged, onSave, onDelete, readOnly = false }: SetEntryRowProps) {
  // Prefer performed_text for the reps display when set: combo entries like
  // "2+2+2" round-trip as the raw string instead of being replaced by the
  // numeric sum (6) on re-render. Falls back to performed_reps for legacy
  // rows. Free-text input also prefers performed_text with a notes fallback
  // so pre-A3 rows that lived in `notes` still surface.
  const initialReps =
    logged?.performed_text ??
    (logged?.performed_reps != null ? String(logged.performed_reps) : '');
  const [load, setLoad] = useState(logged?.performed_load != null ? String(logged.performed_load) : '');
  const [reps, setReps] = useState(initialReps);
  const [text, setText] = useState(logged?.performed_text ?? logged?.notes ?? '');
  const [status, setStatus] = useState<TrainingLogSet['status']>(logged?.status ?? 'pending');
  const [busy, setBusy] = useState(false);

  // Sync local state from server data using primitive dependencies, so a
  // parent re-render with a freshly-allocated `logged` object doesn't
  // reset the inputs while the user is typing.
  useEffect(() => {
    setLoad(logged?.performed_load != null ? String(logged.performed_load) : '');
  }, [logged?.performed_load]);
  useEffect(() => {
    setReps(
      logged?.performed_text ??
        (logged?.performed_reps != null ? String(logged.performed_reps) : ''),
    );
  }, [logged?.performed_reps, logged?.performed_text]);
  useEffect(() => {
    setText(logged?.performed_text ?? logged?.notes ?? '');
  }, [logged?.performed_text, logged?.notes]);
  useEffect(() => {
    setStatus(logged?.status ?? 'pending');
  }, [logged?.status]);

  // Per-row write queue: a numeric cell's onBlur-commit and a status button's
  // onClick-commit can fire in the same gesture. Serializing them so they run
  // in call order (button after blur) makes the later write win, instead of
  // racing at the DB and dropping the status toggle or the typed value.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  const commit = async (overrides: Partial<{
    load: string;
    reps: string;
    text: string;
    status: TrainingLogSet['status'];
  }> = {}) => {
    const nextLoad = overrides.load ?? load;
    const nextReps = overrides.reps ?? reps;
    const nextText = overrides.text ?? text;
    const nextStat = overrides.status ?? status;

    // Build the payload synchronously from the values at call time, so each
    // commit captures its own snapshot before being queued.
    let arg: Parameters<typeof onSave>[0];
    if (input.freeTextMode) {
      // Free-text rows: no numeric load/reps. The merged cell either shows the
      // coach's prose (planned row, freeTextPlanned set) or captures the
      // athlete's prose (extra row → stored on notes).
      arg = {
        setNumber: input.setNumber,
        performedLoad: null,
        performedReps: null,
        status: nextStat,
        plannedLoad: null,
        plannedReps: null,
        performedText: input.freeTextPlanned !== undefined ? null : nextText.trim() || null,
      };
    } else {
      const parsedLoad = parseNumericInput(nextLoad);
      const parsedReps = parseRepsInput(nextReps);
      // When marking completed without explicit values, assume the athlete
      // executed the set as prescribed — tapping the checkmark on a planned set
      // is enough if everything went as written.
      const completing = nextStat === 'completed';
      // Only back-fill the planned load on a value-less ✓ when it is a real
      // kilogram. For percentage / rpe the planned "load" is a % or RPE
      // number; copying it into performed_load would silently log e.g. 80%
      // as 80 kg — corrupting deltas, tonnage and PR detection. The athlete
      // can still type the actual kg they lifted. (TYPE-TRANSLATION-3)
      const performedLoad =
        parsedLoad ?? (completing && input.loadIsKg !== false ? input.plannedLoadValue : null);
      const performedReps =
        parsedReps != null
          ? Math.round(parsedReps)
          : completing
          ? input.plannedRepsValue
          : null;
      // Preserve combo / tuple notation ("2+2+2") in performed_text so the raw
      // string round-trips on display. Numeric-only entries leave it null.
      // Empty input clears it explicitly so cleared rows don't show a stale
      // string after re-render.
      const trimmedReps = nextReps.trim();
      const performedText =
        trimmedReps.includes('+') ? trimmedReps : trimmedReps === '' ? null : undefined;
      arg = {
        setNumber: input.setNumber,
        performedLoad,
        performedReps,
        status: nextStat,
        plannedLoad: input.plannedLoadValue,
        plannedReps: input.plannedRepsValue,
        ...(performedText !== undefined ? { performedText } : {}),
      };
    }

    setBusy(true);
    const mine = chainRef.current.then(() => onSave(arg), () => onSave(arg));
    chainRef.current = mine;
    try {
      await mine;
    } finally {
      if (chainRef.current === mine) setBusy(false);
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

      {!readOnly && (
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
      )}

      {input.freeTextMode ? (
        <div className="flex-1 min-w-0">
          {input.freeTextPlanned !== undefined ? (
            <div className={`text-sm italic px-2 py-1.5 break-words ${isSkipped ? 'text-gray-500 line-through' : 'text-gray-300'}`}>
              {input.freeTextPlanned || '—'}
            </div>
          ) : (
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onBlur={() => commit({ text })}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              placeholder="What did you do?"
              disabled={busy || isSkipped || readOnly}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-blue-500 placeholder:text-gray-600 disabled:opacity-50"
            />
          )}
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-2 gap-1.5">
          <NumericCell
            value={load}
            placeholder={input.plannedLoadText}
            unit="kg"
            onChange={setLoad}
            onCommit={() => commit()}
            disabled={busy || isSkipped || readOnly}
          />
          <NumericCell
            value={reps}
            placeholder={input.plannedRepsText}
            unit="r"
            onChange={setReps}
            onCommit={() => commit()}
            disabled={busy || isSkipped || readOnly}
            // Combo prescriptions ("1+1") need a keyboard that can type "+".
            // inputMode="decimal" gives a numeric pad with no plus key on
            // mobile, trapping athletes once they clear the carried-over
            // sum and try to enter combo notation.
            inputMode={input.plannedRepsText.includes('+') ? 'text' : 'decimal'}
          />
        </div>
      )}
      {onDelete && !readOnly && (
        <button
          onClick={() => void onDelete()}
          disabled={busy}
          className="w-9 h-9 flex items-center justify-center text-gray-500 hover:text-red-400 flex-shrink-0"
          title="Delete this set"
          aria-label="Delete set"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function NumericCell({
  value, placeholder, unit, onChange, onCommit, disabled, inputMode = 'decimal',
}: {
  value: string;
  placeholder: string;
  unit: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  disabled?: boolean;
  inputMode?: 'decimal' | 'text';
}) {
  return (
    <div className="flex items-baseline gap-1 bg-gray-800 border border-gray-700 rounded px-2 py-1.5 focus-within:border-blue-500">
      <input
        type="text"
        inputMode={inputMode}
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
 *
 * `unit` decides how the planned load is presented and whether it's a real
 * kilogram: percentage shows "80%", rpe shows "RPE 8", and both flag
 * loadIsKg=false so a value-less ✓ doesn't log the %/RPE number as kg.
 * Omitting unit (or absolute_kg / legacy null) keeps the kg behaviour.
 */
export function expandSetLines(setLines: PlannedSetLine[], unit?: string | null): SetRowInput[] {
  const loadIsKg = unit == null || unit === 'absolute_kg';
  const out: SetRowInput[] = [];
  let setNumber = 1;
  for (const line of setLines) {
    const count = Math.max(1, line.sets ?? 1);
    const repsText = line.reps_text ?? String(line.reps ?? '');
    const baseLoad =
      line.load_max != null && line.load_max !== line.load_value
        ? `${line.load_value}-${line.load_max}`
        : line.load_value != null
        ? String(line.load_value)
        : '';
    const loadText = !baseLoad
      ? ''
      : unit === 'percentage'
      ? `${baseLoad}%`
      : unit === 'rpe'
      ? `RPE ${baseLoad}`
      : baseLoad;
    for (let i = 0; i < count; i += 1) {
      out.push({
        setNumber,
        plannedRepsText: repsText || '—',
        plannedLoadText: loadText || '—',
        plannedRepsValue: line.reps ?? null,
        plannedLoadValue: line.load_value ?? null,
        loadIsKg,
      });
      setNumber += 1;
    }
  }
  return out;
}
