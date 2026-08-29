/**
 * ConfirmDialog — the replacement for `window.confirm` / `window.alert`.
 *
 * Every destructive action in EMOS used to run through browser chrome:
 * deleting an athlete and all their PRs and week plans, deleting a macrocycle,
 * leaving a club. The copy was already good — it named the consequence — but
 * the vessel was wrong in three ways a design system can fix:
 *
 *   1. the buttons said OK/Cancel instead of the verb, so the control didn't
 *      say what it does;
 *   2. there was no danger styling, though --color-danger-* has always existed;
 *   3. Chrome focuses OK by default, so an Enter keypress after the click
 *      deleted an athlete.
 *
 * ## Why an imperative API
 *
 * `window.confirm` is synchronous, so call sites are written as
 * `if (!confirm(msg)) return;`. A promise-based function keeps that shape —
 * `if (!(await confirmDialog({ ... }))) return;` — instead of forcing 27 call
 * sites to be restructured into open/confirm/cancel state machines.
 *
 * Mount `<ConfirmHost />` once per app root. Then anywhere:
 *
 *   const ok = await confirmDialog({
 *     title: 'Delete Anna?',
 *     message: 'This will also remove all their PRs and week plans.',
 *     confirmLabel: 'Delete athlete',
 *     tone: 'danger',
 *   });
 *
 * Focus starts on Cancel for every `tone: 'danger'` request, so Enter can
 * never complete a destructive action the coach hasn't read.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AdaptiveDialog } from './AdaptiveDialog';
import { Button } from './Button';
import { Input } from './Input';

export interface ConfirmRequest {
  /** Short question. Usually the first sentence of the old confirm() string. */
  title: string;
  /** The consequence. Optional when the title says everything. */
  message?: string;
  /** Must name the action: "Delete athlete", not "OK". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `'danger'` styles the confirm button with the danger tokens and starts
   *  focus on Cancel. `'default'` starts focus on the confirm button. */
  tone?: 'default' | 'danger';
  /** Acknowledge-only: renders a single button and resolves true. */
  acknowledgeOnly?: boolean;
  /**
   * Adds a single-line text field. `promptDialog` resolves to its value, or
   * null if the coach cancelled. `readOnly` + `selectOnOpen` gives the
   * copy-this-link case: the text is there to be selected, not typed into.
   */
  input?: {
    label?: string;
    initialValue?: string;
    placeholder?: string;
    readOnly?: boolean;
    selectOnOpen?: boolean;
  };
}

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void; capture?: (v: string) => void };

let emit: ((req: Pending) => void) | null = null;

/**
 * Ask the coach to confirm. Resolves true if they confirmed, false otherwise.
 * Falls back to `window.confirm` when no <ConfirmHost /> is mounted, so a
 * surface that hasn't adopted the host yet still gets a working prompt rather
 * than a silently-resolving promise.
 */
export function confirmDialog(req: ConfirmRequest): Promise<boolean> {
  if (!emit) {
    const text = req.message ? `${req.title}\n\n${req.message}` : req.title;
    return Promise.resolve(window.confirm(text));
  }
  return new Promise<boolean>(resolve => emit!({ ...req, resolve }));
}

/** Tell the coach something happened. Resolves when they dismiss it. */
export function alertDialog(
  req: Omit<ConfirmRequest, 'acknowledgeOnly' | 'cancelLabel' | 'input'>,
): Promise<boolean> {
  if (!emit) {
    const text = req.message ? `${req.title}\n\n${req.message}` : req.title;
    window.alert(text);
    return Promise.resolve(true);
  }
  return confirmDialog({ ...req, acknowledgeOnly: true });
}

/**
 * Ask for one line of text. Resolves to the value, or null if cancelled.
 * Also covers the show-me-this-string case (`readOnly`), which is what the
 * clipboard fallbacks were using `window.prompt` for.
 */
export function promptDialog(
  req: ConfirmRequest & { input: NonNullable<ConfirmRequest['input']> },
): Promise<string | null> {
  if (!emit) {
    const text = req.message ? `${req.title}\n\n${req.message}` : req.title;
    return Promise.resolve(window.prompt(text, req.input.initialValue ?? ''));
  }
  return new Promise<string | null>(resolve => {
    let value = req.input.initialValue ?? '';
    emit!({
      ...req,
      capture: v => { value = v; },
      resolve: ok => resolve(ok ? value : null),
    });
  });
}

export function ConfirmHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emit = setPending;
    return () => { emit = null; };
  }, []);

  // Danger starts on Cancel — the destructive button should never be the one
  // a stray Enter activates. Everything else starts on the confirm button so
  // a routine yes/no stays one keystroke.
  useEffect(() => {
    if (!pending) return;
    if (pending.input) {
      inputRef.current?.focus();
      if (pending.input.selectOnOpen) inputRef.current?.select();
      return;
    }
    const target = pending.tone === 'danger' && !pending.acknowledgeOnly
      ? cancelRef.current
      : confirmRef.current;
    target?.focus();
  }, [pending]);

  const settle = useCallback((ok: boolean) => {
    setPending(prev => { prev?.resolve(ok); return null; });
  }, []);

  if (!pending) return null;

  const {
    title, message, tone = 'default', acknowledgeOnly = false,
    confirmLabel = acknowledgeOnly ? 'Close' : 'Confirm',
    cancelLabel = 'Cancel',
  } = pending;

  return (
    <AdaptiveDialog
      mode="center"
      align="responsive-end"
      role="alertdialog"
      dismiss="transient"
      maxWidth={420}
      onClose={() => settle(false)}
      title={title}
      closeButton={false}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-sm)' }}>
          {!acknowledgeOnly && (
            <Button ref={cancelRef} variant="secondary" onClick={() => settle(false)}>
              {cancelLabel}
            </Button>
          )}
          <Button
            ref={confirmRef}
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => settle(true)}
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {message && (
        <p style={{
          margin: 0,
          fontSize: 'var(--text-body)',
          lineHeight: 'var(--leading-body)',
          color: 'var(--color-text-secondary)',
        }}>
          {message}
        </p>
      )}
      {pending.input && (
        <div style={{ marginTop: message ? 'var(--space-md)' : 0 }}>
          {pending.input.label && (
            <label
              htmlFor="emos-confirm-input"
              style={{
                display: 'block',
                marginBottom: 'var(--space-xs)',
                fontSize: 'var(--text-label)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {pending.input.label}
            </label>
          )}
          <Input
            id="emos-confirm-input"
            ref={inputRef}
            defaultValue={pending.input.initialValue ?? ''}
            placeholder={pending.input.placeholder}
            readOnly={pending.input.readOnly}
            onChange={e => pending.capture?.(e.target.value)}
            onFocus={pending.input.selectOnOpen ? e => e.currentTarget.select() : undefined}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); settle(true); } }}
            className="w-full"
          />
        </div>
      )}
    </AdaptiveDialog>
  );
}
