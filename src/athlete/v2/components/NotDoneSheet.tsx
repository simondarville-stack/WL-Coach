/**
 * NotDoneSheet — prompt the athlete for a reason when marking a whole
 * session "not done" (sick, injured, travelling, …).
 *
 * Bottom-sheet on mobile, centered on desktop (mirrors BonusDayNameModal).
 * Preset reasons are UI sugar only — the reason is stored as free text on
 * training_log_sessions.skipped_reason, so the taxonomy stays runtime-flexible
 * (no DB enum). "Other" reveals a free-text field; presets can also be refined
 * with extra text before confirming.
 */
import { useEffect, useRef, useState } from 'react';
import { X, Ban } from 'lucide-react';

const PRESETS = ['Sick', 'Injured', 'Travelling', 'Too tired', 'No time', 'Rest day'];

interface NotDoneSheetProps {
  open: boolean;
  /** Pre-fill (e.g. when re-marking a day that was already not-done). */
  defaultReason?: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}

export function NotDoneSheet({ open, defaultReason = '', onClose, onConfirm }: NotDoneSheetProps) {
  const [reason, setReason] = useState(defaultReason);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setError(null);
    }
  }, [open, defaultReason]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = reason.trim();
    if (trimmed === '' || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-sm bg-gray-900 border border-gray-800 rounded-t-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-800">
          <h3 className="text-sm font-bold text-white">Mark session as not done</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-3 py-3 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(p => (
              <button
                key={p}
                onClick={() => setReason(p)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  reason.trim() === p
                    ? 'bg-red-900/50 border-red-700 text-red-200'
                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-1.5">
              Reason
            </span>
            <input
              ref={inputRef}
              type="text"
              value={reason}
              onChange={e => setReason(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !submitting) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Sick, injured, travelling…"
              className="w-full bg-gray-800 border border-gray-700 rounded-md px-2.5 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500"
            />
          </label>
          <p className="text-[10px] text-gray-500 leading-snug">
            Your coach will see this. The planned session stays in your log so you
            can still come back and log it.
          </p>
          {error && <p className="text-[11px] text-red-300 break-all">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-gray-800">
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-[11px] text-gray-400 hover:text-white px-3 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || reason.trim() === ''}
            className="inline-flex items-center gap-1 text-xs font-semibold bg-red-600 hover:bg-red-500 disabled:bg-gray-700 text-white px-3 py-1.5 rounded"
          >
            <Ban size={12} />
            {submitting ? 'Saving…' : 'Mark not done'}
          </button>
        </div>
      </div>
    </div>
  );
}
