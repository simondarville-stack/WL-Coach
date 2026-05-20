/**
 * DoneChip — canonical "done" indicator for exercises and sessions.
 *
 * Renders a filled CheckCircle2 icon + "Done" label. Supports dark (athlete)
 * and light (coach) themes via the `variant` prop. Use `iconOnly` when only
 * the icon is needed (e.g. next to an exercise name in a compact row).
 *
 * Replaces six ad-hoc done indicators across the codebase. (UF-01 / D2)
 */
import { CheckCircle2 } from 'lucide-react';

interface DoneChipProps {
  /** Visual theme. 'dark' = athlete app. 'light' = coach planner. */
  variant?: 'dark' | 'light';
  /** When true, renders only the CheckCircle2 icon without the pill. */
  iconOnly?: boolean;
  size?: number;
  className?: string;
}

export function DoneChip({
  variant = 'dark',
  iconOnly = false,
  size = 13,
  className = '',
}: DoneChipProps) {
  const iconClass = variant === 'dark' ? 'text-emerald-400' : 'text-emerald-600';

  if (iconOnly) {
    return (
      <CheckCircle2
        size={size}
        className={`flex-shrink-0 ${iconClass} ${className}`}
        aria-label="Done"
      />
    );
  }

  const pillClass =
    variant === 'dark'
      ? 'bg-emerald-900/50 text-emerald-300'
      : 'bg-emerald-100 text-emerald-700';

  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded ${pillClass} ${className}`}
      aria-label="Done"
    >
      <CheckCircle2 size={size} className="flex-shrink-0" />
      Done
    </span>
  );
}
