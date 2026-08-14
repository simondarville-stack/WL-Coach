/**
 * AdaptiveDialog — the one overlay primitive.
 *
 * Renders as a centred dialog, a right-edge side panel (the coach's
 * `settings.dialog_mode` preference, "Layout preferences" in General settings),
 * or a bottom sheet. Every EMOS dialog should come through here: the app had
 * four competing primitives, 21 backdrop tints, five z-index conventions, and
 * Escape handling in roughly half of its overlays before this consolidation.
 *
 * ## What you get for free
 * dimmed backdrop on a token · Escape · focus trap + focus restore ·
 * `role`/`aria-modal` · body scroll lock · drag-safety (`data-emos-no-throw`) ·
 * backdrop dismissal that survives a text selection dragged out of the panel
 * (see `useBackdropDismiss`).
 *
 * ## The dismissal contract — pick by what the dialog *holds*
 *
 * | `dismiss`     | Backdrop click | Escape                | Use for |
 * |---------------|----------------|-----------------------|---------|
 * | `'transient'` | closes         | closes                | autosaved or read-only content — nothing to lose |
 * | `'guarded'`   | **never**      | closes only if `!dirty` | buffered, unsaved input |
 *
 * The rule a coach can internalise: *if it can lose your typing, only buttons
 * close it.* Confirms are `'transient'` with `role="alertdialog"`.
 *
 * ## `panel`
 * `'default'` gives the standard panel chrome. `'bare'` renders the child as
 * the panel unstyled — used by dialogs migrated from hand-rolled markup that
 * still carry their own chrome. New dialogs should use `'default'`.
 */
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useBackdropDismiss } from '../../hooks/useBackdropDismiss';

export type DialogMode = 'center' | 'sidebar' | 'sheet';
export type DialogDismiss = 'transient' | 'guarded';

interface AdaptiveDialogProps {
  /** Layout. Defaults to `'center'`. */
  mode?: DialogMode;
  onClose: () => void;
  /** Centered variant only — the sidebar has a fixed width, the sheet is full-bleed. */
  maxWidth?: number;
  /** When set, Enter outside an input/textarea fires this (usually onClose). */
  onEnter?: () => void;
  /** See the dismissal contract above. Defaults to `'transient'`. */
  dismiss?: DialogDismiss;
  /** `'guarded'` only: while true, Escape will not close either. */
  dirty?: boolean;
  /** `'bare'` lets the child supply its own panel chrome. Defaults to `'default'`. */
  panel?: 'default' | 'bare';
  /** `'media'` uses the near-opaque wash — for content that *is* the subject. */
  variant?: 'panel' | 'media';
  role?: 'dialog' | 'alertdialog';
  /** Required when there is no visible `title` to label the dialog. */
  ariaLabel?: string;
  title?: ReactNode;
  /** Show the ✕ in the title bar. Defaults to true whenever `title` is set. */
  closeButton?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Nested dialogs must not each restore `overflow` on unmount — the first one to
 * close would hand scrolling back while an overlay is still up. Ref-count instead.
 */
let scrollLocks = 0;
let scrollLockPrevious = '';

function lockBodyScroll(): () => void {
  if (scrollLocks === 0) {
    scrollLockPrevious = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLocks += 1;
  return () => {
    scrollLocks -= 1;
    if (scrollLocks === 0) document.body.style.overflow = scrollLockPrevious;
  };
}

export function AdaptiveDialog({
  mode = 'center',
  onClose,
  maxWidth = 768,
  onEnter,
  dismiss = 'transient',
  dirty = false,
  panel = 'default',
  variant = 'panel',
  role = 'dialog',
  ariaLabel,
  title,
  closeButton = true,
  footer,
  children,
}: AdaptiveDialogProps) {
  const isSidebar = mode === 'sidebar';
  const isSheet = mode === 'sheet';
  const panelRef = useRef<HTMLDivElement>(null);

  // A guarded dialog never dismisses from the backdrop; passing a no-op keeps
  // the hook's call unconditional.
  const backdrop = useBackdropDismiss(
    useCallback(() => { if (dismiss === 'transient') onClose(); }, [dismiss, onClose]),
  );

  // Move focus into the dialog on open and hand it back on close — without the
  // restore, dismissing a dialog drops the caret at the top of the document and
  // keyboard users lose their place in the table behind it.
  //
  // Focus the *panel*, not its first field: auto-focusing the first input would
  // scroll a dense planner dialog to wherever that input happens to be, and
  // would fight any `autoFocus` the content has already placed deliberately
  // (ConfirmModal puts it on the confirm button). If something inside already
  // took focus, leave it alone.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panelRef.current;
    if (node && !node.contains(document.activeElement)) node.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => lockBodyScroll(), []);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Guarded dialogs hold unsaved input: Escape is only a shortcut while
      // there is nothing to lose.
      if (dismiss === 'guarded' && dirty) return;
      e.stopPropagation();
      onClose();
      return;
    }

    if (
      e.key === 'Enter' &&
      onEnter &&
      !(e.target instanceof HTMLTextAreaElement) &&
      !(e.target instanceof HTMLInputElement)
    ) {
      e.preventDefault();
      onEnter();
      return;
    }

    if (e.key !== 'Tab') return;

    // Keep Tab inside the dialog. Without this, tabbing walks into the page
    // behind the overlay, which is both an a11y failure and a way to type into
    // a form you can't see.
    const node = panelRef.current;
    if (!node) return;
    // No visibility filtering: `offsetParent` is null for anything inside a
    // fixed-position subtree under jsdom (and unreliable in browsers), which
    // silently collapsed the cycle to a single element. The selector already
    // excludes disabled and tabindex="-1" nodes.
    const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const container: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: isSheet ? 'var(--z-sheet)' : 'var(--z-dialog)',
    display: 'flex',
    alignItems: isSidebar ? 'flex-start' : isSheet ? 'flex-end' : 'center',
    justifyContent: isSidebar ? 'flex-end' : 'center',
    padding: isSidebar || isSheet ? 0 : variant === 'media' ? 16 : 24,
  };

  const defaultPanel: React.CSSProperties = isSidebar
    ? {
        width: '100%', maxWidth: 512, height: '100%',
        background: 'var(--color-bg-primary)',
        border: '0.5px solid var(--color-border-primary)',
        borderLeft: '1px solid var(--color-border-secondary)',
        overflowY: 'auto',
      }
    : isSheet
      ? {
          width: '100%',
          background: 'var(--color-bg-primary)',
          borderTop: '0.5px solid var(--color-border-secondary)',
          borderTopLeftRadius: 'var(--radius-xl)',
          borderTopRightRadius: 'var(--radius-xl)',
          maxHeight: '85vh',
        }
      : {
          width: '100%', maxWidth, maxHeight: '85vh',
          background: 'var(--color-bg-primary)',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-xl)',
          overflowY: 'auto',
        };

  const panelStyle: React.CSSProperties = panel === 'bare'
    // The child is the panel; the wrapper only carries focus/aria and keeps the
    // child's own `w-full` / `max-w-*` sizing working inside the flex container.
    ? { position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column',
        alignItems: 'center', width: '100%', maxHeight: '100%', outline: 'none' }
    : { position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column',
        outline: 'none', ...defaultPanel };

  const animation = panel === 'bare'
    ? undefined
    : isSidebar ? 'animate-sidebar-in' : 'animate-dialog-in';

  return (
    <div
      className="animate-backdrop-in"
      // Never a bin for a dragged planner item (see ThrowAwayZone).
      data-emos-no-throw
      style={container}
      onKeyDown={handleKeyDown}
    >
      <div
        data-emos-backdrop
        style={{
          position: 'absolute',
          inset: 0,
          background: variant === 'media' ? 'var(--overlay-media)' : 'var(--overlay-dialog)',
          cursor: dismiss === 'transient' && variant === 'media' ? 'zoom-out' : undefined,
        }}
        {...backdrop}
      />
      <div
        ref={panelRef}
        className={animation}
        style={panelStyle}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
      >
        {title && (
          <div
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: 'var(--space-lg)',
              borderBottom: '0.5px solid var(--color-border-tertiary)',
              flexShrink: 0,
            }}
          >
            <h2
              style={{
                fontSize: 'var(--text-section)', fontWeight: 500,
                letterSpacing: 'var(--tracking-section)', margin: 0,
                color: 'var(--color-text-primary)',
              }}
            >
              {title}
            </h2>
            {closeButton && (
              <button
                onClick={onClose}
                aria-label="Close"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
                  color: 'var(--color-text-tertiary)', display: 'flex',
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        {children}
        {footer && (
          <div
            style={{
              padding: 'var(--space-md) var(--space-lg)',
              borderTop: '0.5px solid var(--color-border-tertiary)',
              display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
