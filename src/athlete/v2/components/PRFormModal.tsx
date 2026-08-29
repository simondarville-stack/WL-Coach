/**
 * PRFormModal — single shared form for adding or editing a PR entry on
 * the athlete side. Identical UX for both modes; the `mode` prop only
 * changes the heading + the call-out copy + which service helper the
 * save handler dispatches.
 *
 * Inputs: rep count (1–10), weight (kg, comma-decimal accepted),
 * achieved date (defaults to today). On save, the parent screen is
 * responsible for refreshing the data and calling syncAthletePRs so the
 * coach side sees the change.
 */
import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import {
  REP_COUNTS,
  type RepCount,
  insertPRHistory,
  supersededLowerReps,
  raiseLowerReps,
  updatePRHistory,
  deletePRHistory,
  syncAthletePRs,
} from '../../../lib/prTable';
import { describeError } from '../../../lib/errorMessage';
import { confirmDialog } from '../../../components/ui';

type Mode =
  | {
      kind: 'add';
      athleteId: string;
      exerciseId: string;
      exerciseName: string;
      defaultRepCount?: RepCount;
    }
  | {
      kind: 'edit';
      athleteId: string;
      exerciseId: string;
      exerciseName: string;
      entryId: string;
      initialValueKg: number;
      initialDate: string;
      repCount: RepCount;
    };

interface Props {
  mode: Mode;
  onClose: () => void;
  /** Called after a successful save / delete so the parent can refetch. */
  onChanged: () => void | Promise<void>;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseWeight(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function PRFormModal({ mode, onClose, onChanged }: Props) {
  const [repCount, setRepCount] = useState<RepCount>(
    mode.kind === 'edit' ? mode.repCount : (mode.defaultRepCount ?? 1),
  );
  const [weightRaw, setWeightRaw] = useState<string>(
    mode.kind === 'edit' ? mode.initialValueKg.toString().replace('.', ',') : '',
  );
  const [date, setDate] = useState<string>(
    mode.kind === 'edit' ? mode.initialDate : todayISO(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const weight = parseWeight(weightRaw);
  const canSave = weight != null && weight > 0 && date.length === 10 && !saving;

  const handleSave = async () => {
    if (!canSave || weight == null) return;
    setSaving(true);
    setError(null);
    try {
      if (mode.kind === 'add') {
        await insertPRHistory({
          athleteId: mode.athleteId,
          exerciseId: mode.exerciseId,
          repCount,
          valueKg: weight,
          achievedDate: date,
        });

        // A PR at more reps beats the records at fewer reps: a 6RM of 80 kg
        // means 80 kg is within reach for 5, 4, 3... too, so an older 5RM of
        // 75 kg is stale and drags the implied-1RM estimate down. Offered, never
        // applied silently — these are the athlete's own records.
        const stale = await supersededLowerReps(mode.athleteId, mode.exerciseId, repCount, weight);
        if (stale.length > 0) {
          const list = stale.map(x => `${x.repCount}RM (${x.currentKg} kg)`).join(', ');
          const ok = await confirmDialog({
            title: `Raise your ${list} to ${weight} kg too?`,
            message: `This ${repCount}RM of ${weight} kg is higher than ${stale.length === 1 ? 'it' : 'them'}. Your older entries stay in the history either way.`,
            confirmLabel: stale.length === 1 ? 'Raise it' : 'Raise them',
            cancelLabel: 'Leave as they are',
          });
          if (ok) {
            await raiseLowerReps({
              athleteId: mode.athleteId,
              exerciseId: mode.exerciseId,
              repCounts: stale.map(x => x.repCount),
              valueKg: weight,
              achievedDate: date,
              sourceRepCount: repCount,
            });
          }
        }
      } else {
        await updatePRHistory(mode.entryId, {
          valueKg: weight,
          achievedDate: date,
        });
      }
      await syncAthletePRs(mode.athleteId, mode.exerciseId);
      await onChanged();
      onClose();
    } catch (e) {
      console.error('[PRFormModal] save failed', e);
      setError(describeError(e));
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (mode.kind !== 'edit' || saving) return;
    const ok = await confirmDialog({
      title: 'Delete this PR entry?',
      message: 'Older history for this rep count will become the current PR.',
      confirmLabel: 'Delete entry',
      tone: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    setError(null);
    try {
      await deletePRHistory(mode.entryId);
      await syncAthletePRs(mode.athleteId, mode.exerciseId);
      await onChanged();
      onClose();
    } catch (e) {
      console.error('[PRFormModal] delete failed', e);
      setError(describeError(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-3 py-6">
      <div
        className="w-full max-w-md bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] rounded-xl shadow-xl flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[color:var(--color-border-tertiary)]">
          <div className="flex flex-col min-w-0">
            <span className="text-[length:var(--text-caption)] uppercase tracking-wider text-[color:var(--color-text-secondary)] font-semibold">
              {mode.kind === 'add' ? 'Log a PR' : 'Edit PR'}
            </span>
            <span className="text-sm font-bold text-white truncate">{mode.exerciseName}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="tap p-1.5 rounded-md text-[color:var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)] hover:text-[color:var(--color-text-primary)] disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          <div>
            <label className="block text-[length:var(--text-caption)] uppercase tracking-wider text-[color:var(--color-text-secondary)] font-semibold mb-1.5">
              Rep count
            </label>
            {mode.kind === 'edit' ? (
              <div className="text-sm text-[color:var(--color-text-primary)] tabular-nums">
                {mode.repCount} {mode.repCount === 1 ? 'rep' : 'reps'}
                <span className="text-[length:var(--text-caption)] text-[color:var(--color-text-secondary)] ml-2">(rep count can't be changed — delete and re-add)</span>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-1.5">
                {REP_COUNTS.map(rc => (
                  <button
                    key={rc}
                    type="button"
                    onClick={() => setRepCount(rc)}
                    className={`py-2 text-sm font-medium rounded-md tabular-nums border transition-colors ${
                      repCount === rc
                        ? 'bg-[var(--color-accent)] border-[color:var(--color-accent)] text-white'
                        : 'bg-[var(--color-bg-page)] border-[color:var(--color-border-tertiary)] text-[color:var(--color-text-secondary)] hover:border-[color:var(--color-border-secondary)] hover:text-[color:var(--color-text-primary)]'
                    }`}
                  >
                    {rc}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="pr-weight"
              className="block text-[length:var(--text-caption)] uppercase tracking-wider text-[color:var(--color-text-secondary)] font-semibold mb-1.5"
            >
              Weight (kg)
            </label>
            <input
              id="pr-weight"
              type="text"
              inputMode="decimal"
              autoFocus
              value={weightRaw}
              onChange={e => setWeightRaw(e.target.value)}
              placeholder="e.g. 120,5"
              className="w-full bg-[var(--color-bg-page)] border border-[color:var(--color-border-tertiary)] rounded-md px-3 py-2 text-base text-white tabular-nums focus:border-[color:var(--color-accent-hover)] outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="pr-date"
              className="block text-[length:var(--text-caption)] uppercase tracking-wider text-[color:var(--color-text-secondary)] font-semibold mb-1.5"
            >
              Achieved date
            </label>
            <input
              id="pr-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              max={todayISO()}
              className="w-full bg-[var(--color-bg-page)] border border-[color:var(--color-border-tertiary)] rounded-md px-3 py-2 text-base text-white focus:border-[color:var(--color-accent-hover)] outline-none"
            />
          </div>

          {error && (
            <div className="px-3 py-2 border border-red-900 bg-red-950/50 rounded text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-[color:var(--color-border-tertiary)]">
          {mode.kind === 'edit' && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={saving}
              className="text-xs text-red-400 hover:text-red-300 px-3 py-2 disabled:opacity-40"
            >
              Delete
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="text-sm text-[color:var(--color-text-primary)] hover:text-white px-3 py-2 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canSave}
            className="inline-flex items-center gap-1.5 text-sm bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-secondary)] disabled:text-[color:var(--color-text-secondary)] text-white font-semibold px-4 py-2 rounded-md"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
