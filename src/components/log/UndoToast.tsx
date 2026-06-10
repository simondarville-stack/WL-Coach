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
  /** Identity of the thing being undone. The auto-dismiss timer re-arms
   *  only when this changes (or visibility flips) — NOT on every parent
   *  re-render. Without it, `onDismiss` being a fresh closure each render
   *  silently re-started the 4 s window, so the commit could be deferred
   *  indefinitely. Pass the pending item's id when the buffer can be
   *  overwritten by a second action. (ATHLETE-ROBUSTNESS-13) */
  resetKey?: string | number | null;
}

export function UndoToast({
  message,
  visible,
  onUndo,
  onDismiss,
  timeoutMs = 4000,
  resetKey,
}: UndoToastProps) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest onDismiss without making it a timer dependency, so a
  // parent re-render that re-creates the closure does not reset the window.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!visible) return;
    timerRef.current = setTimeout(() => {
      onDismissRef.current();
    }, timeoutMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible, timeoutMs, resetKey]);

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
