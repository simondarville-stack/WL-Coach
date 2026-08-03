/**
 * ThrowAwayZone — drop a planner item outside every receivable area to delete
 * it. "Throwing it away."
 *
 * The whole design rests on one HTML5 fact: a `drop` event only fires where
 * some handler called `preventDefault()` during `dragover`. So "outside any
 * receivable area" needs no geometry — it is exactly *a drop that reached the
 * planner root with `defaultPrevented` still false*. Inner handlers run first
 * (React dispatches one synthetic event up the tree), so by the time the root
 * sees it, `defaultPrevented` already answers the question.
 *
 * Deliberately NOT `dragend` + `dropEffect === 'none'`, which is the other
 * obvious implementation: that also fires when the coach presses Escape to
 * cancel, and when the drag leaves the browser window. Both would delete
 * silently. With `drop`, cancelling and leaving the window are inherently safe.
 */
import { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { parseThrowPayload, throwKindFromTypes, type ThrowKind, type ThrowPayload } from './dragPayload';

/**
 * Mark a subtree as never-a-bin. Put it on floating chrome that sits inside the
 * planner's DOM but isn't part of the plan — the dock, dialog overlays.
 */
export const NO_THROW_ATTR = 'data-emos-no-throw';

const isNeutral = (target: EventTarget | null): boolean =>
  !!(target as HTMLElement | null)?.closest?.(`[${NO_THROW_ATTR}]`);

export function useThrowAwayZone(opts: {
  enabled: boolean;
  onThrow: (payload: ThrowPayload) => void;
}) {
  const { enabled, onThrow } = opts;
  const [armedKind, setArmedKind] = useState<ThrowKind | null>(null);

  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!enabled) return;
    // An inner receivable area already claimed this drag.
    if (e.defaultPrevented) { setArmedKind(k => (k ? null : k)); return; }
    if (isNeutral(e.target)) { setArmedKind(k => (k ? null : k)); return; }
    // Ctrl/⌘ means "copy" for the exercise and unit drags; a copy gesture is
    // never a throw, and its effectAllowed flips, which would break the
    // dropEffect pairing below.
    if (e.ctrlKey || e.metaKey) { setArmedKind(k => (k ? null : k)); return; }

    const kind = throwKindFromTypes(e.dataTransfer.types);
    if (!kind) return; // files, text, unmarked drags — not ours

    e.preventDefault();
    // dropEffect MUST be compatible with the source's effectAllowed or the
    // drop event never fires at all (documented the hard way in ClipboardPanel).
    e.dataTransfer.dropEffect = kind === 'clipboard' ? 'copy' : 'move';
    // dragover fires at ~60 Hz — only touch state on an actual change.
    setArmedKind(k => (k === kind ? k : kind));
  }, [enabled]);

  const onDrop = useCallback((e: React.DragEvent) => {
    setArmedKind(null);
    if (!enabled || e.defaultPrevented) return;
    if (isNeutral(e.target)) return;
    const payload = parseThrowPayload(e.dataTransfer.getData('text/plain'));
    if (!payload) return;
    e.preventDefault();
    onThrow(payload);
  }, [enabled, onThrow]);

  const onDragLeave = useCallback(() => setArmedKind(null), []);

  return { zoneProps: { onDragOver, onDrop, onDragLeave }, armedKind };
}

const KIND_COPY: Record<ThrowKind, string> = {
  exercise: 'Release to delete this exercise',
  day: 'Release to clear this training unit',
  clipboard: 'Release to remove from the clipboard',
};

/** The only affordance: a hint pill that appears once a throw is armed. */
export function ThrowAwayHint({ kind }: { kind: ThrowKind | null }) {
  if (!kind) return null;
  return (
    <div
      style={{
        position: 'fixed',
        // Above the dock (z-30), below dialogs (z-50).
        zIndex: 40,
        left: '50%',
        bottom: 'calc(var(--emos-dock-height, 32px) + 12px)',
        transform: 'translateX(-50%)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        fontSize: 'var(--text-caption)',
        color: 'var(--color-danger-text)',
        background: 'var(--color-danger-bg)',
        border: '0.5px solid var(--color-danger-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
      }}
      role="status"
    >
      <Trash2 size={12} />
      {KIND_COPY[kind]}
    </div>
  );
}
