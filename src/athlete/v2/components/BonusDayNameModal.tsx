/**
 * BonusDayNameModal — quick-name prompt before creating a bonus day.
 *
 * Bottom-sheet on mobile, centered on desktop. Default suggestion
 * "Extra N" matches the auto-label fallback so the athlete can just
 * confirm if they don't care about naming.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';

interface BonusDayNameModalProps {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onConfirm: (name: string) => Promise<void>;
}

export function BonusDayNameModal({ open, defaultName, onClose, onConfirm }: BonusDayNameModalProps) {
  const [name, setName] = useState(defaultName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setError(null);
      setTimeout(() => inputRef.current?.select(), 50);
    }
  }, [open, defaultName]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = name.trim();
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
      <div className="w-full sm:max-w-sm bg-[var(--color-bg-primary)] border border-[color:var(--color-border-tertiary)] rounded-t-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[color:var(--color-border-tertiary)]">
          <h3 className="text-sm font-bold text-white">New training day</h3>
          <button
            onClick={onClose}
            className="tap p-1 text-[color:var(--color-text-secondary)] hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-3 py-3 space-y-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wide text-[color:var(--color-text-secondary)] font-semibold mb-1.5">
              Name
            </span>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !submitting) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="e.g. Extra strength, Cardio, Mobility…"
              className="w-full bg-[var(--color-bg-secondary)] border border-[color:var(--color-border-secondary)] rounded-md px-2.5 py-2 text-sm text-white placeholder:text-[color:var(--color-text-tertiary)] focus:outline-none focus:border-[color:var(--color-accent-hover)]"
            />
          </label>
          {error && (
            <p className="text-[11px] text-red-300 break-all">{error}</p>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-[color:var(--color-border-tertiary)]">
          <button
            onClick={onClose}
            disabled={submitting}
            className="tap-y text-[11px] text-[color:var(--color-text-secondary)] hover:text-white px-3 py-1.5 rounded"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting || name.trim() === ''}
            className="tap-y inline-flex items-center gap-1 text-xs font-semibold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] disabled:bg-[var(--color-bg-tertiary)] text-white px-3 py-1.5 rounded"
          >
            <Plus size={12} />
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
