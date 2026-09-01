/**
 * ClipTagSheet — "which lift is this?", asked once per clip.
 *
 * Two ways to answer, because two different things get filmed:
 *
 *   - **A logged set.** One tap on a chip that already reads `S2 · 105 × 2`.
 *     This is the common case and the whole sheet is laid out around making it
 *     a single thumb press, with the likely set pre-selected.
 *   - **Something else.** A warm-up single, an extra attempt, a lift filmed
 *     before the sets were entered. Then the athlete types the load and reps
 *     straight in.
 *
 * Skipping is always one tap and never blocks the upload: a clip with no tag
 * is exactly what every clip was before this existed, and an athlete
 * mid-session should not be made to do admin before their footage is safe.
 */
import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { AdaptiveDialog } from '../ui/AdaptiveDialog';
import { describeSetOption, type ClipTag } from '../../lib/clipTag';
import type { TrainingLogSet } from '../../lib/database.types';

interface ClipTagSheetProps {
  /** Logged sets of the exercise this clip belongs to. May be empty. */
  sets: readonly TrainingLogSet[];
  /** Starting selection — a guess for a new clip, or the current tag when
   *  re-tagging an existing one. */
  initial: ClipTag;
  /** Shown above the chips, e.g. "Clip 2 of 3". */
  caption?: string | null;
  /** Label for the confirm button. */
  confirmLabel?: string;
  onCancel: () => void;
  onSave: (tag: ClipTag) => void;
}

/** Parse a typed number, treating blank and nonsense alike as "not stated". */
function parseNumber(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  return raw.trim() !== '' && Number.isFinite(value) ? value : null;
}

export function ClipTagSheet({
  sets,
  initial,
  caption,
  confirmLabel = 'Save',
  onCancel,
  onSave,
}: ClipTagSheetProps) {
  const [setNumber, setSetNumber] = useState<number | null>(initial.setNumber);
  const [load, setLoad] = useState(
    initial.performedLoad == null ? '' : String(initial.performedLoad).replace('.', ','),
  );
  const [reps, setReps] = useState(initial.performedReps == null ? '' : String(initial.performedReps));

  const save = () =>
    onSave(
      setNumber != null
        ? // A named set owns its own load and reps — see clipTag.ts.
          { setNumber, performedLoad: null, performedReps: null }
        : { setNumber: null, performedLoad: parseNumber(load), performedReps: parseNumber(reps) },
    );

  const chip = (active: boolean) =>
    `px-2 py-1 rounded text-[11px] border transition-colors ${
      active
        ? 'border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/20 text-white'
        : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
    }`;

  return (
    <AdaptiveDialog
      onClose={onCancel}
      panel="bare"
      align="responsive-end"
      ariaLabel="Tag this clip"
    >
      <div className="w-[min(96vw,420px)] bg-gray-900 text-gray-100 rounded-lg border border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
          <div className="min-w-0">
            <div className="text-xs font-semibold tracking-wide">What is in this clip?</div>
            {caption && <div className="text-[10px] text-gray-400 truncate">{caption}</div>}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Skip tagging"
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-3 py-2.5 space-y-2.5">
          {sets.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Set</p>
              <div className="flex flex-wrap gap-1">
                {sets.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSetNumber(n => (n === s.set_number ? null : s.set_number))}
                    className={chip(setNumber === s.set_number)}
                  >
                    {describeSetOption(s)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Manual entry, disabled while a set is chosen: the set already
              states the numbers, and two editable copies would just invite
              a mismatch nobody could resolve later. */}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
              {sets.length > 0 ? 'Or type it' : 'Load and reps'}
            </p>
            <div className="flex items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">Load in kg</span>
                <input
                  inputMode="decimal"
                  value={setNumber == null ? load : ''}
                  disabled={setNumber != null}
                  onChange={e => setLoad(e.target.value)}
                  placeholder="kg"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
                />
              </label>
              <span className="text-gray-500 text-sm">×</span>
              <label className="flex-1">
                <span className="sr-only">Reps</span>
                <input
                  inputMode="numeric"
                  value={setNumber == null ? reps : ''}
                  disabled={setNumber != null}
                  onChange={e => setReps(e.target.value)}
                  placeholder="reps"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-[color:var(--color-accent)] disabled:opacity-40"
                />
              </label>
            </div>
            {setNumber != null && (
              <p className="mt-1 text-[10px] text-gray-500">
                Taken from set {setNumber} — edit the set to change it.
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2.5 border-t border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            className="px-2.5 py-1.5 rounded text-[11px] border border-gray-700 text-gray-400 hover:text-white"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={save}
            className="ml-auto px-3 py-1.5 rounded text-[11px] font-semibold inline-flex items-center gap-1.5 bg-[color:var(--color-accent)] text-white"
          >
            <Check size={13} />
            {confirmLabel}
          </button>
        </div>
      </div>
    </AdaptiveDialog>
  );
}
