/**
 * ConfirmModal — in-app replacement for window.confirm.
 *
 * Renders a bottom-sheet (on narrow viewports) or centred dialog for
 * destructive action confirmations. Supports two risk levels:
 *   - default: neutral confirm / cancel
 *   - danger:  red destructive confirm button
 *
 * Usage:
 *   <ConfirmModal
 *     open={showConfirm}
 *     title="Delete training day?"
 *     description="This removes all logged exercises. Cannot be undone."
 *     confirmLabel="Delete"
 *     variant="danger"
 *     onConfirm={handleDelete}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */
import { useEffect } from 'react';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
      >
        <div className="px-5 pt-5 pb-2">
          <h2
            id="confirm-title"
            className="text-sm font-bold text-gray-900 leading-snug"
          >
            {title}
          </h2>
          {description && (
            <p className="text-xs text-gray-500 mt-1.5 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 px-4 py-4">
          <button
            onClick={onConfirm}
            autoFocus
            className={`w-full py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-gray-900 hover:bg-gray-700 text-white'
            }`}
          >
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
