/**
 * TabBadge — the count dot on a coach-mobile tab icon.
 *
 * Past nine it becomes a plain dot rather than "9+": two glyphs and a plus
 * sign inside 14 px on a phone is a smudge, and the exact number stops
 * mattering long before that — "there is something waiting" is the whole
 * message, and the tab itself carries the detail once tapped. The precise
 * count stays in the accessible label either way.
 */

/** Largest count still legible as a numeral on a 20 px tab icon. */
export const BADGE_MAX_NUMERAL = 9;

interface TabBadgeProps {
  count: number;
  /** Noun phrase completing the label, e.g. "unread threads". */
  label: string;
}

export function TabBadge({ count, label }: TabBadgeProps) {
  if (count <= 0) return null;
  const isDot = count > BADGE_MAX_NUMERAL;
  return (
    <span
      className={`absolute -top-1 -right-2 rounded-full bg-[var(--color-accent)] text-white text-[length:var(--text-micro)] font-bold flex items-center justify-center ${
        isDot ? 'w-[9px] h-[9px]' : 'min-w-[14px] h-[14px] px-0.5'
      }`}
      aria-label={`${count} ${label}`}
    >
      {isDot ? '' : count}
    </span>
  );
}
