import { useCallback, useRef } from 'react';
import type { MouseEvent } from 'react';

/**
 * Backdrop click-to-dismiss that survives a text selection dragged out of the
 * dialog.
 *
 * The obvious implementation — `onClick={onClose}` on the backdrop plus
 * `onClick={e => e.stopPropagation()}` on the panel — has a bug that bites
 * whenever there is prose to select. The browser dispatches `click` at the
 * **nearest common ancestor of the mousedown and mouseup targets**, so
 * selecting text in a field and releasing the button past the panel edge fires
 * the click on the backdrop itself. `stopPropagation` never runs (the panel was
 * never on that event's path), and the dialog closes mid-edit.
 *
 * So dismiss on `mouseup` instead, and only when the gesture both started and
 * ended on the backdrop. Spread the result onto the backdrop element:
 *
 * ```tsx
 * const backdrop = useBackdropDismiss(onClose);
 * return (
 *   <div className="fixed inset-0 …" {...backdrop}>
 *     <div className="…panel…">…</div>   // no stopPropagation needed
 *   </div>
 * );
 * ```
 *
 * The panel's `stopPropagation` guard becomes dead weight and should be removed
 * with the swap: these handlers compare `target` to `currentTarget`, so events
 * bubbling up from inside the panel are ignored on their own merits.
 *
 * Only for backdrops that *wrap* the panel. A backdrop rendered as a sibling of
 * the panel never sees this bug — the click lands on their shared parent — but
 * using the hook there is harmless and keeps the dismissal behaviour uniform.
 */
export function useBackdropDismiss(onDismiss: () => void): {
  onMouseDown: (e: MouseEvent<HTMLElement>) => void;
  onMouseUp: (e: MouseEvent<HTMLElement>) => void;
} {
  const startedOnBackdrop = useRef(false);

  const onMouseDown = useCallback((e: MouseEvent<HTMLElement>) => {
    startedOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onMouseUp = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const startedHere = startedOnBackdrop.current;
      startedOnBackdrop.current = false;
      if (startedHere && e.target === e.currentTarget) onDismiss();
    },
    [onDismiss],
  );

  return { onMouseDown, onMouseUp };
}
