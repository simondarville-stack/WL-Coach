/**
 * @deprecated Use `AdaptiveDialog` directly — it is the one overlay primitive.
 *
 * Kept as a thin adapter so nothing has to migrate in a hurry. It forwards to
 * AdaptiveDialog, so it inherits the dismissal contract, focus trap, Escape,
 * scroll lock, and token'd backdrop for free.
 *
 * Note the default: `dismiss="transient"` (backdrop click closes). If the
 * dialog buffers unsaved input, pass `dismiss="guarded"` — or better, move to
 * AdaptiveDialog and state the contract explicitly.
 */
import type { ReactNode } from 'react';
import { AdaptiveDialog, type DialogDismiss } from './AdaptiveDialog';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: ModalSize;
  dismiss?: DialogDismiss;
  dirty?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

/** Was `rem` strings; AdaptiveDialog takes px. 28/32/42/56rem at 16px/rem. */
const SIZE_WIDTHS: Record<ModalSize, number> = {
  sm: 448,
  md: 512,
  lg: 672,
  xl: 896,
};

export function Modal({
  isOpen,
  onClose,
  title,
  size = 'md',
  dismiss = 'transient',
  dirty,
  children,
  footer,
}: ModalProps) {
  if (!isOpen) return null;

  return (
    <AdaptiveDialog
      onClose={onClose}
      maxWidth={SIZE_WIDTHS[size]}
      dismiss={dismiss}
      dirty={dirty}
      title={title}
      footer={footer}
      ariaLabel={typeof title === 'string' ? title : undefined}
    >
      <div style={{ padding: 'var(--space-lg)', overflowY: 'auto', flex: 1 }}>
        {children}
      </div>
    </AdaptiveDialog>
  );
}
