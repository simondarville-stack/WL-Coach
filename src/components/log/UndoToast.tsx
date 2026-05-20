/**
 * UndoToast — transient 4-second notification with an undo affordance.
 *
 * Used for low-risk, reversible destructive actions (e.g. deleting a
 * single logged set). The toast auto-dismisses; if the user taps "Undo"
 * within the window, the action is reversed by calling onUndo().
 *
 * Usage — caller pattern:
 *   const [pendingDelete, setPendingDelete] = useState<string | null>(null);
 *
 *   const handleDeleteSet = (setId: string) => {
 *     // optimistically remove from UI
 *     setPendingDelete(setId);
 *   };
 *
 *   <UndoToast
 *     message="Set removed"
 *     visible={pendingDelete != null}
 *     onUndo={() => { undoDelete(pendingDelete!); setPendingDelete(null); }}
 *     onDismiss={() => { commitDelete(pendingDelete!); setPendingDelete(null); }}
 *   />
 *
 * Note: the caller is responsible for committing the real deletion in
 * onDismiss (when the timeout fires) and rolling back in onUndo.
 */
import { useEffect, useRef } from 'react';

interface UndoToastProps {
  message: string;
  visible: boolean;
  onUndo: () => void;
  onDismiss: () => void;
  /** Auto-dismiss timeout in milliseconds. Default 4000. */
  timeoutMs?: number;
}

export function UndoToast({
  message,
  visible,
  onUndo,
  onDismiss,
  timeoutMs = 4000,
}: UndoToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) return;
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, onDismiss, timeoutMs]);

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 bg-gray-900 text-white rounded-xl shadow-lg text-sm font-medium"
      role="status"
      aria-live="polite"
    >
      <span>{message}</span>
      <button
        onClick={() => {
          if (timerRef.current) clearTimeout(timerRef.current);
          onUndo();
        }}
        className="text-blue-300 hover:text-blue-100 font-semibold underline-offset-2 hover:underline"
      >
        Undo
      </button>
    </div>
  );
}
