/**
 * @deprecated Use `AdaptiveDialog` from `components/ui` — it is the one overlay
 * primitive. Kept as a thin adapter for the surfaces still on it.
 *
 * Behaviour-preserving on purpose: ModalShell never dismissed from the backdrop
 * and never handled Escape, so it maps to a guarded dialog that is always
 * "dirty". Consumers that have a cancel handler should pass `onClose` — that
 * re-enables Escape, which is what every other EMOS dialog does.
 */
import type { ReactNode } from 'react';
import { AdaptiveDialog } from './ui/AdaptiveDialog';

interface ModalShellProps {
  children: ReactNode;
  /** Tailwind max-w-* class, kept for source compatibility. */
  maxWidth?: string;
  /** Wire this up to enable Escape-to-close. */
  onClose?: () => void;
  ariaLabel?: string;
}

const WIDTHS: Record<string, number> = {
  'max-w-sm': 384,
  'max-w-md': 448,
  'max-w-lg': 512,
  'max-w-xl': 576,
  'max-w-2xl': 672,
  'max-w-3xl': 768,
  'max-w-4xl': 896,
};

export function ModalShell({ children, maxWidth = 'max-w-lg', onClose, ariaLabel }: ModalShellProps) {
  return (
    <AdaptiveDialog
      onClose={onClose ?? (() => {})}
      maxWidth={WIDTHS[maxWidth] ?? 512}
      dismiss="guarded"
      dirty={!onClose}
      ariaLabel={ariaLabel}
    >
      {children}
    </AdaptiveDialog>
  );
}
