/**
 * AdaptiveDialog — overlay that renders as a centered dialog or a right-edge
 * side panel, following the coach's `settings.dialog_mode` preference
 * ("Layout preferences" in General settings).
 *
 * This is the one place that decision lives; surfaces pass `mode` and their
 * content. Both variants: dim backdrop, click-outside to close, and an
 * optional Enter-to-close (used by the planner's editors, where Enter means
 * "done" unless focus is in a text field).
 */
import type { ReactNode } from 'react';

interface AdaptiveDialogProps {
  mode: 'center' | 'sidebar';
  onClose: () => void;
  /** Centered variant only — the sidebar has a fixed width. */
  maxWidth?: number;
  /** When set, Enter outside an input/textarea fires this (usually onClose). */
  onEnter?: () => void;
  children: ReactNode;
}

export function AdaptiveDialog({
  mode,
  onClose,
  maxWidth = 768,
  onEnter,
  children,
}: AdaptiveDialogProps) {
  const isSidebar = mode === 'sidebar';
  return (
    <div
      className="animate-backdrop-in"
      style={isSidebar
        ? { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end' }
        : { position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onKeyDown={onEnter
        ? (e) => {
            if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
              e.preventDefault();
              onEnter();
            }
          }
        : undefined}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.2)' }} onClick={onClose} />
      <div
        className={isSidebar ? 'animate-sidebar-in' : 'animate-dialog-in'}
        style={isSidebar
          ? { position: 'relative', zIndex: 10, width: '100%', maxWidth: 512, height: '100%', background: 'var(--color-bg-primary)', border: '0.5px solid var(--color-border-primary)', borderLeft: '1px solid var(--color-border-secondary)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }
          : { position: 'relative', zIndex: 10, width: '100%', maxWidth, maxHeight: '85vh', background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-secondary)', display: 'flex', flexDirection: 'column', overflowY: 'auto', borderRadius: 'var(--radius-xl)' }}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
